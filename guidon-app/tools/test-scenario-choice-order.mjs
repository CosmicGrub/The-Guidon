/**
 * Scenario choices are shown in a random order, fixed once per run, in every
 * solo screen (text, course, adventure, training).
 *
 * WHY THIS SUITE EXISTS. Audit 2026-09, item 7: in the authored scenario data
 * the best answer was listed FIRST on 97% of the decisions that have a best
 * answer, and "always pick A" earned 97% of the maximum score - so the 205
 * scenarios, which feed Progress's competency readiness, its LRM radar and the
 * training pass bar, could be beaten on position alone. The fix is one helper
 * in the engine (orderedChoices) that every solo screen goes through. Deleting
 * this file would let the following ship unnoticed:
 *   - a screen that skips the helper (the best answer is back in slot A);
 *   - letters handed out BEFORE the shuffle, so a letter key picks a different
 *     choice than the one under that letter;
 *   - an order that is redrawn on every render, so a decision that comes round
 *     again (a loop back to the same node) shows the choices in a new order;
 *   - a choice that is filtered out by a story flag turning up anyway, or a
 *     visible one going missing;
 *   - the opt-outs (fixedOrder on a node, on a scenario, in G.engine.run's
 *     options, and the tests' own G.engine.pinChoiceOrder) not holding;
 *   - the team-discussion (collective) screens being shuffled - they keep the
 *     authored order on purpose;
 *   - the training screen marking the wrong button "correct" (it matches the
 *     buttons to its own list by position) or scoring a run differently;
 *   - the sc-ncoer decision whose three feedback strings described a different
 *     question than the choices they sat under, and the three feedback strings
 *     that named "option A" / "the first option" (meaningless once shuffled).
 *
 * How the failing side was proven (the mutation record): with orderedChoices
 * made an identity function, the distribution checks fail (the best answer is
 * in slot A on every one of the 300 runs, in all four screens) and the
 * seeded-order check fails; with the memo dropped (a fresh draw on every
 * render) the loop check fails; with letters read from the authored position
 * the letter-key checks fail; with the training reveal matching the authored
 * list, the training check fails.
 *
 * Randomness: the 300-run distribution checks seed the draw
 * (G.engine.seedChoiceOrder), so the same 300 orders come up on every run and
 * no once-in-a-million fluke can fail CI; the bounds (each slot 20-47% of 300
 * for three choices, about five standard deviations wide) are loose enough that
 * any fair shuffle passes and tight enough that a broken one - which is off by
 * 50 points or more - cannot. The REAL Math.random path (nothing seeded, nothing
 * pinned) is covered by the control check in section 3: an ordinary decision
 * must come out in many different orders across 40 unseeded runs.
 */
import { bootApp, check, finish, until, clickWhenStable, waitForRoute, expectNoConsoleNoise } from "./testkit.mjs";

const boot = await bootApp({ viewport: { width: 1000, height: 900 } });
const { page, noise } = boot;
// A screen that does not redraw itself or steal focus while a scenario runs.
await waitForRoute(page, "#/settings", { ready: "#route h1, #route h2" });

/* ---- in-page helpers: run a scenario in a detached host, read what is on screen ---- */
await page.evaluate(() => {
  const G = window.G;
  const SEL = {
    text: ".mode-text .console button.choice:not(.choice-continue)",
    course: ".mode-course button.choice",
    cyoa: ".mode-cyoa button.hotspot",
    training: ".mode-training button.tr-choice",
  };
  const labelOf = (mode, b) => {
    if (mode === "training") return b.querySelector(".tr-choice-text").textContent;
    if (mode === "cyoa") return b.textContent;
    return b.textContent.replace(/^\[[A-H]\]\s*/, "");
  };
  const co = window.__co = {
    SEL,
    host: null,
    fresh() { if (co.host) co.host.remove(); const h = document.createElement("div"); h.id = "co-host"; document.body.appendChild(h); co.host = h; return h; },
    // sc: a stored scenario id, or a scenario OBJECT (lent to the engine for the one lookup at the top of run()).
    run(sc, mode, options) {
      const host = co.fresh(), store = G.store, real = store.scenario;
      const id = typeof sc === "string" ? sc : sc.id;
      if (typeof sc !== "string") store.scenario = function (x) { return x === id ? sc : real.apply(store, arguments); };
      try { G.engine.run(id, mode, host, null, options); } finally { store.scenario = real; }
    },
    shown(mode) { return Array.from(co.host.querySelectorAll(SEL[mode])).map((b) => labelOf(mode, b)); },
    // The choice a Soldier should pick: the training flag, or else the highest total score.
    bestText(choices) {
      const flagged = choices.find((c) => c.correct);
      if (flagged) return flagged.text;
      const sum = (c) => Object.values(c.score || {}).reduce((a, b) => a + b, 0);
      return choices.slice().sort((a, b) => sum(b) - sum(a))[0].text;
    },
    // 300 fresh runs of one node's screen: how often does the best answer land in each slot?
    // The draw is seeded so the same 300 orders come up on every run of this suite (no
    // chance of a once-in-a-million fluke failing CI); the unseeded, real-Math.random path is
    // proven separately by the "control" check in section 3.
    distribution(id, nodeId, mode, runs, seed) {
      const choices = G.store.scenario(id).nodes[nodeId].choices;
      const best = co.bestText(choices), counts = choices.map(() => 0);
      let missing = 0;
      G.engine.seedChoiceOrder(seed);
      try {
        for (let i = 0; i < runs; i++) {
          co.run(id, mode);
          const at = co.shown(mode).indexOf(best);
          if (at < 0) missing++; else counts[at]++;
        }
      } finally { G.engine.seedChoiceOrder(); }
      co.fresh().remove(); co.host = null;
      return { counts, missing, runs, slots: choices.length };
    },
  };
});

const J = (v) => JSON.stringify(v);
const inPage = (fn, arg) => page.evaluate(fn, arg);
const hostSel = (s) => "#co-host " + s;

/* ---- fixtures (all lent to the engine as objects) ---- */
const FIXTURES = await page.evaluate(() => {
  const mini = (id, nodes, extra) => Object.assign({ id, title: "QA " + id, tier: ["E4"], competency: ["Leads"], difficulty: "Basic", defaultMode: "course", renderModes: ["text", "course", "cyoa"], start: "n1", nodes }, extra || {});
  const four = (id, extra, nodeExtra) => mini(id, {
    n1: Object.assign({ prompt: "Decide.", choices: [
      { text: "Alpha", goto: "end", score: { Leads: 3 }, feedback: "Alpha feedback." },
      { text: "Bravo", goto: "end", score: { Leads: 2 }, feedback: "Bravo feedback." },
      { text: "Charlie", goto: "end", score: { Leads: 1 }, feedback: "Charlie feedback." },
      { text: "Delta", goto: "end", score: { Leads: 0 }, feedback: "Delta feedback." },
    ] }, nodeExtra || {}),
    end: { end: true, outcome: "Done." },
  }, extra);
  return {
    four: four("qa-order-four"),
    nodeFixed: four("qa-order-node-fixed", null, { fixedOrder: true }),
    scenarioFixed: four("qa-order-scenario-fixed", { fixedOrder: true }),
    // n1 comes round again: Alpha/Bravo/Charlie go to n2 (one Continue) which comes straight back; Delta ends it.
    loop: mini("qa-order-loop", {
      n1: { prompt: "Decide.", choices: [
        { text: "Alpha", goto: "n2", score: { Leads: 1 } }, { text: "Bravo", goto: "n2" }, { text: "Charlie", goto: "n2" }, { text: "Delta", goto: "end" },
      ] },
      n2: { prompt: "Regroup.", choices: [{ text: "Go back", goto: "n1" }] },
      end: { end: true, outcome: "Done." },
    }),
    // Bravo and Delta are hidden by story flags; only Alpha, Charlie and Echo may ever be shown.
    hidden: mini("qa-order-hidden", {
      n1: { prompt: "Decide.", choices: [
        { text: "Alpha", goto: "end" }, { text: "Bravo", goto: "end", showIf: "neverSet" }, { text: "Charlie", goto: "end" },
        { text: "Delta", goto: "end", requires: "neverSet" }, { text: "Echo", goto: "end", showIf: { not: "neverSet" } },
      ] },
      end: { end: true, outcome: "Done." },
    }),
    one: mini("qa-order-one", { n1: { prompt: "One step.", choices: [{ text: "Go on", goto: "end" }] }, end: { end: true, outcome: "Done." } }),
    // Echo is hidden until Alpha is picked (it sets a story flag); when n1 comes round again Echo is
    // visible, and Alpha/Bravo/Charlie must keep the relative order they had the first time.
    flagged: mini("qa-order-flagged", {
      n1: { prompt: "Decide.", choices: [
        { text: "Alpha", goto: "n2", set: { sawEcho: true } }, { text: "Bravo", goto: "n2" }, { text: "Charlie", goto: "n2" },
        { text: "Echo", goto: "end", showIf: "sawEcho" },
      ] },
      n2: { prompt: "Regroup.", choices: [{ text: "Go back", goto: "n1" }] },
      end: { end: true, outcome: "Done." },
    }),
  };
});

const AUTHORED = ["Alpha", "Bravo", "Charlie", "Delta"];
const sortedJ = (a) => J(a.slice().sort());

/* =====================================================================
   1. The regression: the best answer lands in every slot, on every screen
   ===================================================================== */
for (const [mode, label] of [["course", "Course"], ["cyoa", "Adventure"], ["text", "Text"]]) {
  const d = await inPage(({ mode }) => window.__co.distribution("sc-ncoer", "n1", mode, 300, 7001), { mode });
  const shares = d.counts.map((n) => Math.round((n / d.runs) * 100));
  check(d.missing === 0 && d.counts.length === 3 && d.counts.every((n) => n / d.runs >= 0.20 && n / d.runs <= 0.47),
    `${label} screen, 300 runs of sc-ncoer's first decision: the best answer lands in slot A/B/C ${shares.join("% / ")}% of the time (each between 20% and 47%)`,
    () => `${label} screen: best-answer slots over ${d.runs} runs: ${J(d)}`);
}
{
  const d = await inPage(() => window.__co.distribution("sc-train-opsec", "q1", "training", 300, 7002));
  const shares = d.counts.map((n) => Math.round((n / d.runs) * 100));
  check(d.missing === 0 && d.counts.length === 4 && d.counts.every((n) => n / d.runs >= 0.14 && n / d.runs <= 0.38),
    `Training screen, 300 runs of sc-train-opsec's first question: the correct answer lands in slots A-D ${shares.join("% / ")}% of the time (each between 14% and 38%)`,
    () => `Training screen: correct-answer slots over ${d.runs} runs: ${J(d)}`);
}

/* =====================================================================
   2. The shuffle is a shuffle of what is visible, and only that
   ===================================================================== */
{
  const r = await inPage((fx) => {
    const seen = new Set(); let bad = null;
    for (let i = 0; i < 60 && !bad; i++) {
      window.__co.run(fx.hidden, "course");
      const t = window.__co.shown("course");
      seen.add(JSON.stringify(t));
      if (t.length !== 3 || t.slice().sort().join() !== ["Alpha", "Charlie", "Echo"].join()) bad = t;
    }
    return { bad, orders: seen.size };
  }, FIXTURES);
  check(!r.bad && r.orders > 1, "choices hidden by a story flag never appear, every visible one always does, and the visible ones are mixed (" + r.orders + " different orders in 60 runs)", () => "hidden-choice fixture: " + J(r));
}
{
  const r = await inPage((fx) => {
    let same = true;
    for (let i = 0; i < 20; i++) { window.__co.run(fx.one, "course"); if (window.__co.shown("course").join() !== "Go on") same = false; }
    return { same, buttons: window.__co.shown("course") };
  }, FIXTURES);
  check(r.same && r.buttons.length === 1, "a decision with a single choice (a plain Continue) is untouched", () => "single-choice fixture: " + J(r));
}

/* =====================================================================
   3. Opt-outs and the test hooks keep the authored order
   ===================================================================== */
{
  // The control first: the same four choices with no opt-out really do get mixed, on every screen.
  const r = await inPage((fx) => {
    const out = {};
    for (const mode of ["text", "course", "cyoa"]) {
      const seen = new Set();
      for (let i = 0; i < 40; i++) { window.__co.run(fx.four, mode); seen.add(window.__co.shown(mode).join(">")); }
      out[mode] = seen.size;
    }
    return out;
  }, FIXTURES);
  check(r.text > 4 && r.course > 4 && r.cyoa > 4, "control: an ordinary four-choice decision comes out in many different orders on the text, course and adventure screens (" + J(r) + " of 24 possible in 40 runs)", () => "control orders: " + J(r));
}
{
  const r = await inPage((fx) => {
    const out = { node: true, scenario: true, option: true, pinned: true, pinBack: false };
    for (let i = 0; i < 30; i++) {
      window.__co.run(fx.nodeFixed, "course"); if (window.__co.shown("course").join() !== "Alpha,Bravo,Charlie,Delta") out.node = false;
      window.__co.run(fx.scenarioFixed, "cyoa"); if (window.__co.shown("cyoa").join() !== "Alpha,Bravo,Charlie,Delta") out.scenario = false;
      window.__co.run(fx.four, "text", { fixedOrder: true }); if (window.__co.shown("text").join() !== "Alpha,Bravo,Charlie,Delta") out.option = false;
    }
    G.engine.pinChoiceOrder(true);
    for (let i = 0; i < 30; i++) { window.__co.run(fx.four, "course"); if (window.__co.shown("course").join() !== "Alpha,Bravo,Charlie,Delta") out.pinned = false; }
    G.engine.pinChoiceOrder(false);
    const seen = new Set(); for (let i = 0; i < 40; i++) { window.__co.run(fx.four, "course"); seen.add(window.__co.shown("course").join()); }
    out.pinBack = seen.size > 1;
    return out;
  }, FIXTURES);
  check(r.node, "fixedOrder: true on a node keeps that decision in the authored order (30 runs)", () => "node fixedOrder: " + J(r));
  check(r.scenario, "fixedOrder: true on a scenario keeps every decision in the authored order (30 runs)", () => "scenario fixedOrder: " + J(r));
  check(r.option, "G.engine.run's { fixedOrder: true } option keeps the authored order (30 runs)", () => "run option fixedOrder: " + J(r));
  check(r.pinned, "G.engine.pinChoiceOrder(true) - the tests' own hook - keeps the authored order (30 runs) ...", () => "pinned: " + J(r));
  check(r.pinBack, "... and pinChoiceOrder(false) puts the shuffle back", () => "unpinned: " + J(r));
}
{
  const r = await inPage((fx) => {
    const runOnce = (seed) => { G.engine.seedChoiceOrder(seed); const o = []; for (let i = 0; i < 6; i++) { window.__co.run(fx.four, "course"); o.push(window.__co.shown("course").join()); } return o.join("|"); };
    const a = runOnce(1234), b = runOnce(1234), c = runOnce(99);
    G.engine.seedChoiceOrder();
    return { same: a === b, different: a !== c, a };
  }, FIXTURES);
  check(r.same && r.different, "G.engine.seedChoiceOrder(n) makes the draw repeatable (same seed, same six orders; another seed, other orders) and seedChoiceOrder() restores real randomness", () => "seeded orders: " + J(r));
}
{
  // Collective (team discussion) screens keep the authored order on purpose.
  const r = await inPage((fx) => {
    const orders = new Set();
    for (let i = 0; i < 30; i++) {
      const host = window.__co.fresh();
      G.engine.runCollective(fx.four, host, null, { discussionSeconds: 10 });
      orders.add(Array.from(host.querySelectorAll(".collective-choice")).map((b) => b.textContent).join(" | "));
    }
    return [...orders];
  }, FIXTURES);
  check(r.length === 1 && r[0] === "A. Alpha | B. Bravo | C. Charlie | D. Delta", "the collective (team discussion) screen keeps the authored order (30 runs, one order)", () => "collective orders: " + J(r));
}

/* =====================================================================
   4. Letters follow what is on screen, on both screens that have them
   ===================================================================== */
// A seed whose draw is NOT the authored order, so a letter read from the authored position would be wrong.
const seed = await inPage((fx) => {
  for (let k = 1; k < 200; k++) {
    G.engine.seedChoiceOrder(k); window.__co.run(fx.four, "course");
    const t = window.__co.shown("course");
    if (t[0] !== "Alpha" && t[1] !== "Bravo" && t[2] !== "Charlie") return k;
  }
  return null;
}, FIXTURES);
check(seed !== null, "fixture sanity: a seed exists whose draw moves the first three choices off their authored slots", "no such seed found in 200 tries");
const FEEDBACK = { Alpha: "Alpha feedback.", Bravo: "Bravo feedback.", Charlie: "Charlie feedback.", Delta: "Delta feedback." };
for (const [mode, key, label] of [["course", "b", "Course"], ["text", "c", "Text"]]) {
  const slot = "abcdefgh".indexOf(key);
  const shown = await inPage(({ fx, seed, mode }) => {
    G.engine.seedChoiceOrder(seed);
    window.__co.run(fx.four, mode);
    return { shown: window.__co.shown(mode), letters: Array.from(window.__co.host.querySelectorAll(window.__co.SEL[mode])).map((b) => (b.textContent.match(/^\[([A-H])\]/) || [])[1] || null) };
  }, { fx: FIXTURES, seed, mode });
  check(J(shown.letters) === J(["A", "B", "C", "D"]), `${label} screen: the letters are handed out top to bottom AFTER the shuffle (${shown.shown.join(", ")} carry A, B, C, D)`, () => `${label} letters: ${J(shown)}`);
  await page.locator(hostSel(mode === "course" ? ".mode-course" : ".mode-text")).focus();
  await page.keyboard.press(key);
  const expected = FEEDBACK[shown.shown[slot]];
  const got = await until(page, (want) => { const f = document.querySelector("#co-host .feedback"); return !!f && f.textContent.indexOf(want) === 0; }, expected);
  const seenFeedback = await page.evaluate(() => (document.querySelector("#co-host .feedback") || {}).textContent);
  check(got, `${label} screen: pressing the "${key}" key picks the choice shown in slot ${key.toUpperCase()} ("${shown.shown[slot]}"), not the one authored there`,
    () => `${label} screen: after the "${key}" key the feedback was ${J(seenFeedback)}, wanted ${J(expected)}`);
  if (mode === "text") {
    const echo = await page.evaluate(() => Array.from(document.querySelectorAll("#co-host .console .prompt")).map((p) => p.textContent.trim()).filter((t) => /^>\s*[A-H]$/.test(t)));
    check(J(echo) === J(["> C"]), 'Text screen: the transcript echoes the letter of the slot that was picked ("> C")', () => "text echo: " + J(echo));
  }
}
await inPage(() => G.engine.seedChoiceOrder());

/* =====================================================================
   5. One order per run: a decision that comes round again looks the same
   ===================================================================== */
for (const mode of ["course", "cyoa", "text"]) {
  const seenFirst = new Set();
  let sameEveryTime = true, detail = "";
  for (let run = 0; run < 8; run++) {
    await inPage(({ fx, mode }) => window.__co.run(fx.loop, mode), { fx: FIXTURES, mode });
    const first = await inPage(({ mode }) => window.__co.shown(mode), { mode });
    seenFirst.add(first.join());
    const pick = (re) => mode === "cyoa" ? page.locator(hostSel("button.hotspot"), { hasText: re }) : page.locator(hostSel(mode === "course" ? ".mode-course button.choice" : ".mode-text .console button.choice:not(.choice-continue)"), { hasText: re });
    await clickWhenStable(page, pick(/Alpha/));
    await clickWhenStable(page, page.locator(hostSel(mode === "cyoa" ? "button.btn.primary" : mode === "course" ? ".course-continue-btn" : ".choice-continue")));
    await until(page, () => /Regroup\./.test((document.getElementById("co-host") || {}).textContent || ""));
    await clickWhenStable(page, pick(/Go back/));
    await clickWhenStable(page, page.locator(hostSel(mode === "cyoa" ? "button.btn.primary" : mode === "course" ? ".course-continue-btn" : ".choice-continue")).last());
    // Text mode appends to one transcript, so the second showing is the LAST four choices in it; the others redraw the screen.
    await until(page, (m) => { const t = document.getElementById("co-host").textContent; const decides = (t.match(/Decide\./g) || []).length; return m === "text" ? decides >= 2 : (decides >= 1 && !/Regroup\./.test(t)); }, mode);
    const again = await inPage(({ mode }) => window.__co.shown(mode).slice(mode === "text" ? -4 : 0), { mode });
    if (again.join() !== first.join()) { sameEveryTime = false; detail = J({ mode, first, again }); }
  }
  check(sameEveryTime && seenFirst.size > 1, `${mode === "cyoa" ? "Adventure" : mode[0].toUpperCase() + mode.slice(1)} screen: when a decision comes round again in the same run its choices are in the same order as the first time (8 runs, ${seenFirst.size} different first orders)`, () => "loop: " + detail);
}

/* 5b. A story flag that reveals one more choice on the way back to a decision must not
   reshuffle the choices the Soldier already saw: their relative order stays put. */
for (const mode of ["course", "cyoa"]) {
  let stable = true, detail = "", sawEchoLater = 0, firstOrders = new Set();
  const cont = hostSel(mode === "cyoa" ? "button.btn.primary" : ".course-continue-btn");
  const pick = (re) => page.locator(hostSel(mode === "cyoa" ? "button.hotspot" : ".mode-course button.choice"), { hasText: re });
  for (let run = 0; run < 8; run++) {
    await inPage(({ fx, mode }) => window.__co.run(fx.flagged, mode), { fx: FIXTURES, mode });
    const first = await inPage(({ mode }) => window.__co.shown(mode), { mode });
    firstOrders.add(first.join());
    await clickWhenStable(page, pick(/Alpha/));
    await clickWhenStable(page, page.locator(cont));
    await until(page, () => /Regroup\./.test((document.getElementById("co-host") || {}).textContent || ""));
    await clickWhenStable(page, pick(/Go back/));
    await clickWhenStable(page, page.locator(cont).last());
    await until(page, () => /Decide\./.test((document.getElementById("co-host") || {}).textContent || "") && !/Regroup\./.test(document.getElementById("co-host").textContent));
    const again = await inPage(({ mode }) => window.__co.shown(mode), { mode });
    if (again.includes("Echo")) sawEchoLater++;
    const sameSeen = again.filter((t) => t !== "Echo").join() === first.join();
    if (!sameSeen || again.length !== 4) { stable = false; detail = J({ mode, first, again }); }
  }
  check(stable && sawEchoLater === 8 && firstOrders.size > 1, `${mode === "cyoa" ? "Adventure" : "Course"} screen: when a story flag adds a fourth choice on the way back, the three already seen keep their order (8 runs, ${firstOrders.size} different first orders)`, () => "flag-revealed choice: " + detail);
}

/* =====================================================================
   6. Fixing the order does not change what a run scores or how training reveals
   ===================================================================== */
{
  // Honest path: pick the best answer BY TEXT at every decision of sc-ncoer, 6 runs, whatever order it is shown in.
  const expected = await inPage(() => {
    const sc = G.store.scenario("sc-ncoer"); const sum = (c) => Object.values(c.score || {}).reduce((a, b) => a + b, 0);
    const total = {}; let id = sc.start, steps = 0;
    while (id && !sc.nodes[id].end && steps++ < 20) {
      const best = sc.nodes[id].choices.slice().sort((a, b) => sum(b) - sum(a))[0];
      for (const k in best.score || {}) total[k] = (total[k] || 0) + best.score[k];
      id = best.goto;
    }
    return total;
  });
  const bestByNode = await inPage(() => {
    const sc = G.store.scenario("sc-ncoer"); const sum = (c) => Object.values(c.score || {}).reduce((a, b) => a + b, 0);
    return { n1: sc.nodes.n1.choices.slice().sort((a, b) => sum(b) - sum(a))[0].text, n2: sc.nodes.n2.choices.slice().sort((a, b) => sum(b) - sum(a))[0].text };
  });
  let allSame = true, last = null;
  for (let run = 0; run < 6; run++) {
    await inPage(() => window.__co.run("sc-ncoer", "course"));
    for (const node of ["n1", "n2"]) {
      await until(page, (n) => { const p = document.querySelector("#co-host .slide .prompt"); return !!p && (n === "n1" ? /SGT Vance/.test(p.textContent) : /Remember: the RATER/.test(p.textContent)); }, node);
      await clickWhenStable(page, page.locator(hostSel(".mode-course button.choice"), { hasText: bestByNode[node] }));
      await clickWhenStable(page, page.locator(hostSel(".course-continue-btn")));
    }
    await until(page, () => !!document.querySelector("#co-host .panel.outcome"));
    last = await inPage(() => Object.fromEntries(Array.from(document.querySelectorAll("#co-host .score-cell")).map((c) => [c.querySelector(".l").textContent, Number(c.querySelector(".n").textContent.replace("+", ""))])));
    for (const k of Object.keys(expected)) if (last[k] !== expected[k]) allSame = false;
  }
  check(allSame, "playing sc-ncoer's best answers by text in six shuffled runs always scores the same as the authored best path (" + J(expected) + ")", () => "last shuffled run scored " + J(last) + ", expected " + J(expected));
}
{
  // Training: the buttons are matched to the shuffled list (right button green, wrong pick red, correct-answer text shown).
  let allRight = true, detail = "", incorrectRuns = 0;
  for (let run = 0; run < 12; run++) {
    await inPage(() => window.__co.run("sc-train-opsec", "training"));
    const wrongPick = run % 2 === 0;
    const q = await inPage(() => {
      const ch = G.store.scenario("sc-train-opsec").nodes.q1.choices;
      const correct = ch.find((c) => c.correct), wrong = ch.find((c) => !c.correct);
      return { correct: correct.text, correctFeedback: correct.feedback, wrong: wrong.text };
    });
    await until(page, () => !!document.querySelector("#co-host .mode-training .tr-choice"));
    await clickWhenStable(page, page.locator(hostSel("button.tr-choice"), { hasText: wrongPick ? q.wrong : q.correct }));
    const seen = await inPage(() => {
      const t = (sel) => Array.from(document.querySelectorAll("#co-host " + sel)).map((b) => b.querySelector(".tr-choice-text").textContent);
      return { green: t("button.tr-correct"), red: t("button.tr-wrong"), verdict: (document.querySelector("#co-host .tr-verdict") || {}).textContent || "", reveal: (document.querySelector("#co-host .tr-correct-ans") || {}).textContent || "" };
    });
    const okRun = J(seen.green) === J([q.correct])
      && (wrongPick ? (J(seen.red) === J([q.wrong]) && /Incorrect/.test(seen.verdict) && seen.reveal.indexOf(q.correctFeedback) >= 0) : (seen.red.length === 0 && /Correct/.test(seen.verdict) && !/Incorrect/.test(seen.verdict) && seen.reveal === ""));
    if (!okRun) { allRight = false; detail = J({ run, wrongPick, q, seen }); }
    if (wrongPick) incorrectRuns++;
  }
  check(allRight && incorrectRuns > 0, "Training screen, 12 shuffled runs (wrong and right picks): the green button is always the correct answer, the red one the pick, and the reveal quotes the correct answer's own feedback", () => "training reveal: " + detail);
}

/* =====================================================================
   7. The content that goes with the shuffle
   ===================================================================== */
{
  const c = await inPage(() => {
    const sc = G.store.scenario("sc-ncoer"); const ch = sc.nodes.n1.choices;
    const by = (re) => ch.find((x) => re.test(x.text));
    return { honest: by(/honestly/).feedback, inflate: by(/top marks/).feedback, downplay: by(/Downplay/).feedback, count: ch.length };
  });
  check(c.count === 3 && !/support form/i.test(c.honest + c.inflate + c.downplay),
    "sc-ncoer's first decision: none of the three feedback strings is the old Support Form text that described a different question", () => "sc-ncoer n1 feedback: " + J(c));
  check(/^Right\./.test(c.honest) && /^Wrong\./.test(c.inflate) && /^Wrong\./.test(c.downplay), "...the honest answer is marked right and the two counterproductive ones wrong", () => "sc-ncoer n1 verdicts: " + J(c));
  check(/top mark/i.test(c.inflate) && /earned/i.test(c.inflate), "...the 'give him top marks' feedback is about giving top marks he has not earned", () => "inflate feedback: " + c.inflate);
  check(/marking him down/i.test(c.downplay) && /tough/i.test(c.downplay), "...the 'downplay' feedback is about marking him down to look tough", () => "downplay feedback: " + c.downplay);
  check(/AR 623-3, para 1-9\)/.test(c.honest) && /AR 623-3, para 1-4b\(9\)\)/.test(c.honest), "...and it cites only AR 623-3 paragraphs read from the bundled Library edition (1-9 and 1-4b(9), 'candid assessments'), not the unverified 'Ch 2' / 'para 3-12'", () => "honest feedback: " + c.honest);
  check(!/Ch 2|para 3-12/.test(c.honest + c.inflate + c.downplay), "...and none of the three carries the old, unverified 'Ch 2' or 'para 3-12' citation", () => "old citations still present: " + (c.honest + c.inflate + c.downplay));
  const refs = await inPage(() => {
    const get = (id) => G.store.scenario(id).nodes.n1.choices.map((x) => x.feedback || "").join(" ");
    return { appearance: get("sc-pres-appearance"), peer: get("sc-dev-peer"), crisis: get("sc-pres-crisis") };
  });
  const lettered = /\boption [A-H]\b|\b(first|second|third|last) option\b/i;
  check(!lettered.test(refs.appearance) && !lettered.test(refs.peer) && !lettered.test(refs.crisis),
    "sc-pres-appearance, sc-dev-peer and sc-pres-crisis no longer point at 'option A' / 'the first option' - a position that no longer means anything", () => "letter references left: " + J(refs));
}
{
  // The same two shuffle-safety rules, over EVERY scenario in the bank (so a future scenario that
  // says "option A" or leads a choice with "First," is caught here, not by a confused Soldier):
  //   (1) no text names a slot ("option B", "the first choice");
  //   (2) in a shuffled decision no choice is order-led ("1)", "Step 2", "Then,", "all of the above").
  // The scan function is also run on planted scenarios, so the rule is shown to be able to FAIL,
  // and a fixedOrder node/scenario is shown to be exempt from rule (2).
  const r = await inPage(() => {
    const NAMES_A_SLOT = /\b(option|choice|answer|response)\s+\(?[A-H]\)?(?![A-Za-z0-9])|\b(first|second|third|fourth|last)\s+(option|choice)\b|\b(options|choices)\s+[A-H]\b/i;
    const ORDER_LED = /^\s*(\(?\d+[).:]|step\s*\d|first[,:]|second[,:]|third[,:]|finally[,:]|lastly[,:]|then[,:]|next[,:])|\b(none|all|both|neither) of the (above|these|previous)\b/i;
    const strings = (x, out) => { if (typeof x === "string") out.push(x); else if (Array.isArray(x)) x.forEach((v) => strings(v, out)); else if (x && typeof x === "object") Object.keys(x).forEach((k) => strings(x[k], out)); return out; };
    const scan = (scs) => {
      const named = [], led = []; let multi = 0;
      scs.forEach((sc) => {
        const nodes = sc.nodes || {};
        const collective = Object.keys(nodes).some((k) => nodes[k] && nodes[k].discuss);
        Object.keys(nodes).forEach((k) => {
          const n = nodes[k]; if (!n) return;
          strings(n, []).forEach((s) => { if (NAMES_A_SLOT.test(s)) named.push(sc.id + ":" + k + " " + s.slice(0, 60)); });
          const ch = Array.isArray(n.choices) ? n.choices : [];
          if (ch.length < 2) return;
          multi++;
          if (collective || sc.fixedOrder || n.fixedOrder) return;
          ch.forEach((c) => { if (ORDER_LED.test(String(c.text || c.say || ""))) led.push(sc.id + ":" + k + " " + String(c.text || c.say).slice(0, 60)); });
        });
      });
      return { named, led, multi };
    };
    const planted = [
      { id: "p-named", nodes: { n1: { prompt: "x", choices: [{ text: "Yes", feedback: "Better than option B." }, { text: "No" }] } } },
      { id: "p-led", nodes: { n1: { prompt: "x", choices: [{ text: "Step 1: call it in" }, { text: "Then, move out" }] } } },
      { id: "p-led-fixed-node", nodes: { n1: { prompt: "x", fixedOrder: true, choices: [{ text: "Step 1: call it in" }, { text: "Step 2: move out" }] } } },
      { id: "p-led-fixed-scenario", fixedOrder: true, nodes: { n1: { prompt: "x", choices: [{ text: "First, call it in" }, { text: "Second, move out" }] } } },
    ];
    return { bank: scan(G.store.seed().scenarios.scenarios), planted: scan(planted), plantedOne: planted.map((p) => scan([p])) };
  });
  check(r.bank.named.length === 0, "no scenario text in the bank names a slot ('option B', 'the first choice') - " + r.bank.multi + " decisions scanned", () => "slot-naming text: " + J(r.bank.named));
  check(r.bank.led.length === 0, "no shuffled decision in the bank has an order-led choice ('Step 2', 'Then,', 'all of the above')", () => "order-led choices: " + J(r.bank.led));
  check(r.bank.multi > 300, "sanity: the scan really walked the bank (" + r.bank.multi + " multi-choice decisions)", () => "scanned " + r.bank.multi);
  check(r.plantedOne[0].named.length === 1 && r.plantedOne[1].led.length === 2 && r.plantedOne[2].led.length === 0 && r.plantedOne[3].led.length === 0,
    "the rules can fail: a planted 'option B' and a planted 'Step 1' / 'Then,' decision are caught, while fixedOrder on the node or the scenario exempts an ordered list", () => "planted: " + J(r.plantedOne));
}

expectNoConsoleNoise(noise);
await finish("SCENARIO CHOICE ORDER");
