/**
 * Roadmap Tier 7 (120Hz/90Hz motion cleanup): "6 elements still animate
 * width/height instead of transform; prioritize the two continuous
 * countdown timers (.mb-timerfill, .quiz-timer-fill) since those run for a
 * whole timed drill, not once."
 *
 * Re-auditing the claim found .mb-timerfill and .quiz-timer-fill (the two
 * priority items) were ALREADY converted to transform:scaleX() by earlier,
 * undocumented work - both assertions below for those two are regression
 * coverage that never existed, not proof of a fix made in this pass. The
 * remaining real, live elements the "6" count referred to were exactly
 * four CSS declarations: .bar > span (transition:width, ~20 el() call
 * sites across Home/Progress/Train/Board Drill), and .trend-bar (two
 * separate transition:height declarations under the same class name -
 * Progress's weekly activity chart and Home's 7-day sparkline, structurally
 * different components). A fifth candidate, .prog-cat-fill
 * (transition:width 0.4s ease, line ~3250), is dead CSS: grep confirms no
 * element anywhere in this file is ever given that class, so it never
 * animates anything a Soldier could see and is intentionally left alone.
 * .mb-cat-bar and .fin-bar-c/.fin-bar-g also set width via JS but declare
 * NO transition at all (checked directly below) - a plain one-shot layout,
 * not an animation, so also correctly out of scope.
 *
 * Of the .trend-bar pair, only Progress's weekly chart (pixel heights,
 * e.g. "37px") was converted in this pass - Home's 7-day sparkline
 * (percentage heights, e.g. "45%") was investigated and deliberately left
 * alone at the time: its .trend-bar-wrap sat in a permanently-indefinite-
 * height flex chain (.trend-bar-wrap's flex:1 expanded to flex-basis:0%,
 * and its parent .trend-col was never stretched by .trend-bars-row's
 * align-items:flex-end), so every height:<pct>% on it resolved to ~0 and
 * only ever displayed via the inline min-height:3px floor - confirmed
 * live at the time, even the "today" bar (height:100%) rendered at
 * exactly 3px, identical to every 0%-count day. A transform:scaleY()
 * needs a real non-zero reference box to scale from; scaling that
 * permanently-0px box would have made every bar fully invisible instead
 * of the flat-3px-regardless-of-value look, a real visual regression
 * ("performance-only, not a visual redesign" per this Tier's own brief) -
 * so it stayed transition:height, flagged as its own follow-up rather
 * than silently expanding this pass's scope.
 *
 * That follow-up landed separately: .trend-bars-row now uses
 * align-items:stretch, so .trend-bar-wrap gets a real, definite height
 * and its .trend-bar's height:<pct>% genuinely resolves per day's count.
 * Section (4) below has been updated to assert THAT state (bars vary
 * proportionally with count) instead of the old uniform-3px-floor bug -
 * still checking transition:height, not transform, since the
 * transform:scaleY() conversion itself (now a safe candidate, per the
 * above) is intentionally still a separate, not-yet-taken follow-up.
 *
 * This file covers the .bar > span and Progress's .trend-bar conversions
 * made in this pass, confirming for each:
 *   1. computed transition-property no longer includes width/height
 *   2. computed transition-property includes transform instead
 *   3. a real fill state (headline/mini-bar readiness pct, or a seeded
 *      trend-chart bucket) resolves to the exact expected transform
 *      scale, cross-checked against the same store API the UI itself
 *      reads (store.getProgress(), not a hardcoded number)
 *   4. .bar > span's reduce-motion behavior (the shared `html.reduce-motion
 *      *` rule in the base stylesheet) is unchanged by the width->transform
 *      switch
 *
 * The two priority timers (.mb-timerfill / .quiz-timer-fill) get their own
 * real-countdown regression coverage: a live Mock Board timed question and
 * a live timed Quiz question, each polled over several real seconds,
 * cross-checking the fill's computed transform against ground truth (Mock
 * Board's own visible "Ns" readout; Quiz's discrete 1/20 step count, since
 * Quiz has no visible numeric readout) at multiple checkpoints - not just
 * "it changed once" but a real, monotonically-decreasing, exactly-matching
 * value trail across the drill.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const close = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.006 : eps);

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

// In-page helper: computed transform's scaleX/scaleY factor (assumes a
// single-axis scale with no rotation/skew, exactly what every fill bar
// here uses). getComputedStyle reports "none" for the identity transform.
const scaleHelperSrc = `
  window.__scaleOf = function (el, axis) {
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return 1;
    const m = t.match(/^matrix\\(([^,]+),\\s*([^,]+),\\s*([^,]+),\\s*([^,]+),/);
    if (!m) return null;
    const a = parseFloat(m[1]), b = parseFloat(m[2]), c = parseFloat(m[3]), d = parseFloat(m[4]);
    return axis === "y" ? d : a;
  };
`;

await page.goto(url, { waitUntil: "load" });
await page.addScriptTag({ content: scaleHelperSrc });
await page.waitForTimeout(700);

// Bypass onboarding via a guest session.
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

/* ------------------------------------------------------------------ *
 * (0) Confirm the un-touched, no-transition siblings really have no
 *     transition at all - the reason .mb-cat-bar/.fin-bar-c/.fin-bar-g
 *     and dead .prog-cat-fill were left alone, not an oversight.
 * ------------------------------------------------------------------ */
const untouchedCheck = await page.evaluate(() => {
  // Checked BEFORE the probe exists, so the probe itself (which briefly
  // wears the "prog-cat-fill" class below) can't self-match this query.
  const progCatFillLive = document.querySelector(".prog-cat-fill");
  const probe = document.createElement("div");
  probe.className = "mb-cat-bar";
  document.body.appendChild(probe);
  const mbCatBarTransition = getComputedStyle(probe).transitionProperty;
  probe.className = "fin-bar-c";
  const finBarTransition = getComputedStyle(probe).transitionProperty;
  probe.className = "prog-cat-fill";
  const progCatFillTransition = getComputedStyle(probe).transitionProperty;
  probe.remove();
  return { mbCatBarTransition, finBarTransition, progCatFillTransition, progCatFillLiveCount: progCatFillLive ? 1 : 0 };
});
untouchedCheck.mbCatBarTransition === "all"
  ? ok(".mb-cat-bar declares no transition (transition-property: all, the CSS default) - confirmed out of scope, not touched")
  : bad(".mb-cat-bar unexpectedly has transitionProperty=" + untouchedCheck.mbCatBarTransition);
untouchedCheck.finBarTransition === "all"
  ? ok(".fin-bar-c declares no transition - confirmed out of scope, not touched")
  : bad(".fin-bar-c unexpectedly has transitionProperty=" + untouchedCheck.finBarTransition);
untouchedCheck.progCatFillTransition.includes("width")
  ? ok(".prog-cat-fill still has a live transition:width rule (dead CSS, left alone) - transitionProperty=" + untouchedCheck.progCatFillTransition)
  : bad(".prog-cat-fill's transition-property changed unexpectedly: " + untouchedCheck.progCatFillTransition);
untouchedCheck.progCatFillLiveCount === 0
  ? ok(".prog-cat-fill is never actually applied to any rendered element (confirmed dead - no live animation to fix)")
  : bad(".prog-cat-fill IS applied to a live element - it was wrongly assumed dead and should have been converted");

/* ------------------------------------------------------------------ *
 * (1) .bar > span - structural CSS + reduce-motion, via a live instance
 * ------------------------------------------------------------------ */
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(500);

const barCss = await page.evaluate(() => {
  const span = document.querySelector(".bar > span");
  if (!span) return null;
  const cs = getComputedStyle(span);
  document.documentElement.classList.add("reduce-motion");
  const reducedDur = getComputedStyle(span).transitionDuration;
  document.documentElement.classList.remove("reduce-motion");
  const normalDur = getComputedStyle(span).transitionDuration;
  return {
    transitionProperty: cs.transitionProperty,
    // offsetWidth is the LAYOUT box width - unaffected by transform (this
    // span may well be sitting at transform:scaleX(0) on a fresh guest
    // profile, which collapses its PAINTED size to 0 - getBoundingClientRect
    // would wrongly read that as "width isn't 100%"). Compare against
    // .bar's own clientWidth (content-box, excludes .bar's 1px border on
    // each side) - that's the box a real width:100% child actually fills.
    spanWidth: span.offsetWidth,
    barClientWidth: span.parentElement.clientWidth,
    normalDur, reducedDur,
  };
});
barCss ? ok("found a live .bar > span on #/home to inspect") : bad("no .bar > span found on #/home - can't verify the conversion");
if (barCss) {
  (barCss.transitionProperty.includes("transform") && !/width|height/.test(barCss.transitionProperty))
    ? ok(".bar > span now transitions transform, not width/height (transition-property: " + barCss.transitionProperty + ")")
    : bad(".bar > span transition-property is \"" + barCss.transitionProperty + "\" - still includes width/height or lost transform");
  close(barCss.spanWidth, barCss.barClientWidth, 1)
    ? ok(".bar > span is a fixed width:100% of its .bar track's content box (" + barCss.spanWidth.toFixed(1) + "px ~= " + barCss.barClientWidth + "px) - the fill fraction is now transform-only, not layout width")
    : bad(".bar > span width (" + barCss.spanWidth + "px) != its .bar parent's content-box width (" + barCss.barClientWidth + "px) - width is not fixed at 100%");
  const reducedMs = parseFloat(barCss.reducedDur) * (barCss.reducedDur.includes("ms") ? 1 : 1000);
  const normalMs = parseFloat(barCss.normalDur) * (barCss.normalDur.includes("ms") ? 1 : 1000);
  (reducedMs < 1 && normalMs > 300)
    ? ok("html.reduce-motion still collapses .bar > span's transition (normal " + barCss.normalDur + " -> reduced " + barCss.reducedDur + "), same shared rule as before")
    : bad("reduce-motion did not collapse .bar > span's transition as expected (normal=" + barCss.normalDur + " reduced=" + barCss.reducedDur + ")");
}

/* ------------------------------------------------------------------ *
 * (2) .bar > span - value correctness, cross-checked against the real
 *     store.getProgress() the UI itself reads. Checked at the guest
 *     baseline (competencyReadiness must be exactly 0, an easy exact
 *     case) AND after seeding one real attempt (a non-trivial value),
 *     for both the Home headline bar and all six competency mini-bars.
 * ------------------------------------------------------------------ */
async function readHomeBars(pg) {
  return pg.evaluate(() => {
    const findBarAfter = (labelText) => {
      const stat = [...document.querySelectorAll(".stat")].find((s) => (s.textContent || "").includes(labelText));
      const bar = stat && stat.nextElementSibling && stat.nextElementSibling.classList.contains("bar") ? stat.nextElementSibling : null;
      const span = bar ? bar.querySelector("span") : null;
      return span ? window.__scaleOf(span, "x") : null;
    };
    const headline = findBarAfter("Promotable Readiness");
    const minis = [...document.querySelectorAll(".card")].map((card) => {
      const k = card.querySelector(".stat .k");
      const span = card.querySelector(".bar > span");
      return k && span ? { name: k.textContent, scaleX: window.__scaleOf(span, "x") } : null;
    }).filter(Boolean);
    return { headline, minis };
  });
}

const baselineProgress = await page.evaluate(() => window.G.store.getProgress());
const baselineBars = await readHomeBars(page);
close(baselineBars.headline, baselineProgress.competencyReadiness / 100)
  ? ok("guest baseline: Home headline .bar scaleX (" + baselineBars.headline + ") matches getProgress().competencyReadiness/100 (" + (baselineProgress.competencyReadiness / 100) + ")")
  : bad("guest baseline headline scaleX " + baselineBars.headline + " != expected " + (baselineProgress.competencyReadiness / 100));

// Seed one real, scored attempt via the same G.store API the app itself
// uses (test-progress-trend-chart.mjs's own pattern) - moves
// competencyReadiness off zero with a value this test computes from
// getProgress() rather than hardcoding, so it stays correct even if the
// pct formula changes later.
await page.evaluate(async () => {
  await window.G.store.recordAttempt({
    scenarioId: "qa-fillbar-transform-test",
    title: "QA fillbar transform test",
    mode: "text",
    score: { Leads: 5, Develops: 0, Achieves: 0, Character: 0, Presence: 0, Intellect: 0 },
    total: 5,
  });
});
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(500);

const seededProgress = await page.evaluate(() => window.G.store.getProgress());
const seededBars = await readHomeBars(page);
seededProgress.competencyReadiness > 0
  ? ok("seeded attempt raised competencyReadiness off zero (" + seededProgress.competencyReadiness + "%) - a real non-trivial value to check")
  : bad("seeded attempt did not change competencyReadiness (" + seededProgress.competencyReadiness + "%) - test setup is not exercising a real value");
close(seededBars.headline, seededProgress.competencyReadiness / 100)
  ? ok("after seeding: Home headline .bar scaleX (" + seededBars.headline + ") matches getProgress().competencyReadiness/100 (" + (seededProgress.competencyReadiness / 100) + ")")
  : bad("after seeding: headline scaleX " + seededBars.headline + " != expected " + (seededProgress.competencyReadiness / 100));

const DIM_ORDER = ["Leads", "Develops", "Achieves", "Character", "Presence", "Intellect"];
let miniAllOk = seededBars.minis.length >= 6;
if (!miniAllOk) bad("expected at least 6 competency mini-bars on #/home after seeding, found " + seededBars.minis.length);
for (const d of DIM_ORDER) {
  const found = seededBars.minis.find((m) => m.name === d);
  const expected = seededProgress.dims[d].pct / 100;
  if (!found) { bad("mini-bar for \"" + d + "\" not found on #/home"); miniAllOk = false; continue; }
  if (!close(found.scaleX, expected)) { bad("mini-bar \"" + d + "\" scaleX " + found.scaleX + " != expected " + expected + " (dims." + d + ".pct=" + seededProgress.dims[d].pct + ")"); miniAllOk = false; }
}
miniAllOk
  ? ok("all 6 competency mini-bars' scaleX exactly match getProgress().dims[*].pct/100 (Leads=" + seededProgress.dims.Leads.pct + "% -> real 100%-scored dim, others 0%)")
  : bad("one or more competency mini-bars did not match getProgress()'s own dims - see above");

/* ------------------------------------------------------------------ *
 * (3) .trend-bar (Progress's weekly activity chart, 56px reference,
 *     transform:scaleY from transform-origin:bottom). Gated on
 *     p.last7Days.length, so the same seeded attempt above (recorded
 *     "now") is what makes it render at all - today's bucket is the
 *     only non-zero one, other 6 days fall back to the barH=3 floor.
 * ------------------------------------------------------------------ */
await page.evaluate(() => { location.hash = "#/progress"; });
await page.waitForTimeout(600);

const weeklyChart = await page.evaluate(() => {
  const cols = [...document.querySelectorAll(".trend-chart .trend-col")];
  if (!cols.length) return null;
  return cols.map((col, i) => {
    const bar = col.querySelector(".trend-bar");
    const cs = getComputedStyle(bar);
    return {
      i, height: cs.height, transitionProperty: cs.transitionProperty,
      scaleY: window.__scaleOf(bar, "y"), title: bar.title,
    };
  });
});
weeklyChart && weeklyChart.length === 7
  ? ok("Progress's weekly activity chart rendered all 7 day-columns (seeded attempt made p.last7Days non-empty)")
  : bad("expected 7 .trend-col columns on #/progress, got " + (weeklyChart ? weeklyChart.length : "none (chart did not render)"));
if (weeklyChart) {
  const badHeights = weeklyChart.filter((b) => b.height !== "56px");
  badHeights.length === 0
    ? ok("every weekly-chart .trend-bar has the fixed 56px reference height (fill fraction is transform-only now, not layout height)")
    : bad(badHeights.length + " weekly-chart bar(s) do NOT have height:56px: " + badHeights.map((b) => b.i + "=" + b.height).join(", "));
  const badTransition = weeklyChart.filter((b) => !b.transitionProperty.includes("transform") || /height/.test(b.transitionProperty));
  badTransition.length === 0
    ? ok("every weekly-chart .trend-bar transitions transform, not height")
    : bad(badTransition.length + " weekly-chart bar(s) still transition height: " + badTransition.map((b) => b.i + "=" + b.transitionProperty).join(", "));
  const today = weeklyChart[6];
  close(today.scaleY, 1, 0.02)
    ? ok("today's weekly-chart bar (the only non-zero day) scales to ~1.0 (" + today.scaleY.toFixed(3) + ") - full 56px reference height, title=\"" + today.title + "\"")
    : bad("today's weekly-chart bar scaleY=" + today.scaleY + ", expected ~1.0 (title=\"" + today.title + "\")");
  const emptyDay = weeklyChart[0];
  close(emptyDay.scaleY, 3 / 56, 0.01)
    ? ok("an empty day's weekly-chart bar scales to the 3/56 zero-floor (" + emptyDay.scaleY.toFixed(4) + " ~= " + (3 / 56).toFixed(4) + ")")
    : bad("empty-day weekly-chart bar scaleY=" + emptyDay.scaleY + ", expected ~" + (3 / 56).toFixed(4));
}

/* ------------------------------------------------------------------ *
 * (4) .trend-bar (Home's 7-day activity sparkline) - deliberately NOT
 *     converted to transform:scaleY() in THIS pass, see the header
 *     comment and the matching CSS/JS comments at .trend-bar's second
 *     declaration and its el() call site. The layout bug that ruled the
 *     conversion out here (.trend-bar-wrap's containing block was
 *     permanently indefinite) has since been fixed separately
 *     (.trend-bars-row now uses align-items:stretch), so this section now
 *     confirms bars genuinely vary with their day's count - not the old
 *     "every bar pinned at the 3px floor" bug - while still transitioning
 *     height rather than transform (the scaleY() conversion itself is a
 *     distinct, not-yet-taken follow-up).
 * ------------------------------------------------------------------ */
await page.evaluate(async () => {
  await window.G.store.recordTrainingComplete("qa-fillbar-transform-training", 90);
});
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(600);

const sparkline = await page.evaluate(() => {
  const bars = [...document.querySelectorAll(".trend-bars-row .trend-col .trend-bar-wrap .trend-bar")];
  if (!bars.length) return null;
  return bars.map((bar, i) => {
    const cs = getComputedStyle(bar);
    return { i, heightPx: bar.getBoundingClientRect().height, transitionProperty: cs.transitionProperty };
  });
});
sparkline && sparkline.length === 7
  ? ok("Home's 7-day activity sparkline rendered all 7 day-bars (seeded training completion made it non-empty)")
  : bad("expected 7 sparkline .trend-bar bars on #/home, got " + (sparkline ? sparkline.length : "none (sparkline did not render)"));
if (sparkline) {
  sparkline.every((b) => b.transitionProperty.includes("height"))
    ? ok("Home's sparkline .trend-bar still transitions height (transform:scaleY() conversion is a separate follow-up, not taken here)")
    : bad("Home's sparkline .trend-bar transition-property changed unexpectedly: " + sparkline.map((b) => b.transitionProperty).join(", "));
  // Only today (index 6) has a non-zero count (the single seeded training
  // completion), so it's the isToday/height:100% bar - every other day is
  // a 0-count floor bar. Before the .trend-bars-row align-items fix, ALL
  // seven rendered at the same ~3px floor regardless of this; now today's
  // bar should genuinely resolve taller than the 0-count floor, proving
  // .trend-bar-wrap has a real definite height for its percentage-height
  // child to resolve against again.
  const today = sparkline[6];
  const zeroDayHeights = sparkline.slice(0, 6).map((b) => b.heightPx);
  const maxZeroDay = Math.max(...zeroDayHeights);
  (today.heightPx > maxZeroDay + 2)
    ? ok("today's bar (the only non-zero count, height:100%) genuinely resolves taller than the 0-count floor bars - " +
         today.heightPx.toFixed(1) + "px vs floor " + zeroDayHeights.map((h) => h.toFixed(1)).join(",") +
         "px - the .trend-bar-wrap definite-height fix is live, not the old uniform-3px bug")
    : bad("today's bar (" + today.heightPx.toFixed(1) + "px) is NOT meaningfully taller than the 0-count floor bars (" +
          zeroDayHeights.map((h) => h.toFixed(1)).join(",") + "px) - the sparkline may be back to the old pinned-3px-regardless-of-count bug");
}

/* ------------------------------------------------------------------ *
 * (5) .mb-timerfill - Mock Board's real per-question countdown. Was
 *     already transform-based before this pass (no code change here);
 *     this is the regression coverage that never existed for it.
 * ------------------------------------------------------------------ */
await page.evaluate(() => { window.G.db.setSetting("board:mockHistory:v1", []); });
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(500);
await page.locator("button", { hasText: /^Mock Board$/ }).click();
await page.waitForTimeout(300);

// 30s/question (the smallest option in the UI), 5 questions.
await page.locator("select").first().selectOption("5");
const secSel = page.locator("select").nth(1);
await secSel.selectOption("30");
await page.locator("button.mb-start", { hasText: /begin board/i }).click();
await page.waitForTimeout(200);
await page.locator("button", { hasText: /I've reported/i }).click();
await page.waitForTimeout(150);

const mbInitial = await page.evaluate(() => {
  const fill = document.querySelector(".mb-timerfill");
  if (!fill) return null;
  const cs = getComputedStyle(fill);
  return { transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration, scaleX: window.__scaleOf(fill, "x") };
});
mbInitial
  ? ok("Mock Board's .mb-timerfill renders on the live question")
  : bad("could not find .mb-timerfill after starting a Mock Board question");
if (mbInitial) {
  (mbInitial.transitionProperty.includes("transform") && !/width|height/.test(mbInitial.transitionProperty))
    ? ok(".mb-timerfill transitions transform, not width/height (transition-property: " + mbInitial.transitionProperty + ")")
    : bad(".mb-timerfill transition-property is \"" + mbInitial.transitionProperty + "\"");
  close(mbInitial.scaleX, 1, 0.001)
    ? ok(".mb-timerfill starts a fresh question at scaleX(1) (full bar)")
    : bad(".mb-timerfill initial scaleX=" + mbInitial.scaleX + ", expected 1");
}

// Poll real elapsed seconds, cross-checking the fill's computed scaleX
// against the DOM's own visible "Ns" countdown readout (.mb-timer) at
// each sample - not a fixed 50%-elapsed instant (real setInterval timing
// jitter would make that flaky) but a bounds check repeated at several
// real checkpoints across the drill. .mb-timerfill's `transition:transform
// 1s linear` means a sample almost never lands exactly on rest: each tick
// sets a NEW target (remaining/30) and the fill spends the following full
// second linearly gliding toward it from the PREVIOUS target
// ((remaining+1)/30) - that continuous glide, not an instant snap, is
// the entire point of this Tier's fix. So each sample is checked against
// the linear-interpolation band [remaining/30, (remaining+1)/30] (both
// values the DOM's own remaining readout implies as this tick's start and
// end), not a single exact number.
let mbSamples = [];
for (let i = 0; i < 7; i++) {
  await page.waitForTimeout(2200);
  const sample = await page.evaluate(() => {
    const fill = document.querySelector(".mb-timerfill");
    const timerText = document.querySelector(".mb-timer");
    if (!fill || !timerText) return null;
    const m = (timerText.textContent || "").match(/^(\d+)s$/);
    return m ? { remaining: Number(m[1]), scaleX: window.__scaleOf(fill, "x") } : null;
  });
  if (sample) mbSamples.push(sample);
}
mbSamples.length >= 5
  ? ok("collected " + mbSamples.length + " real Mock Board timer samples over ~" + (mbSamples.length * 2.2).toFixed(1) + "s")
  : bad("only collected " + mbSamples.length + " Mock Board timer samples - expected at least 5 (timer may have stalled)");
const mbEps = 0.01;
const mbMismatches = mbSamples.filter((s) => {
  const lo = s.remaining / 30 - mbEps, hi = Math.min(1, (s.remaining + 1) / 30) + mbEps;
  return !(s.scaleX >= lo && s.scaleX <= hi);
});
mbMismatches.length === 0 && mbSamples.length
  ? ok("every sampled .mb-timerfill scaleX falls inside its tick's linear-glide band, matching the visible countdown's remaining/30..(remaining+1)/30 (samples: " + mbSamples.map((s) => s.remaining + "s->" + s.scaleX.toFixed(3)).join(", ") + ")")
  : (mbSamples.length ? bad(mbMismatches.length + "/" + mbSamples.length + " samples fell outside their expected band: " + JSON.stringify(mbMismatches)) : null);
const mbRemainings = mbSamples.map((s) => s.remaining);
const mbMonotonic = mbRemainings.every((r, i) => i === 0 || r <= mbRemainings[i - 1]);
const mbActuallyTicked = mbSamples.length >= 2 && mbRemainings[mbRemainings.length - 1] < mbRemainings[0];
(mbMonotonic && mbActuallyTicked)
  ? ok("Mock Board countdown genuinely progressed over real time (remaining: " + mbRemainings.join(" -> ") + ")")
  : bad("Mock Board countdown did not monotonically progress: " + mbRemainings.join(" -> "));

// Reduce-motion check for the live .mb-timerfill (same shared global rule
// as .bar > span above - confirms the width->transform swap for the OTHER
// bars didn't somehow change behavior for this already-transform-based one).
const mbReduced = await page.evaluate(() => {
  const fill = document.querySelector(".mb-timerfill");
  if (!fill) return null;
  document.documentElement.classList.add("reduce-motion");
  const reduced = getComputedStyle(fill).transitionDuration;
  document.documentElement.classList.remove("reduce-motion");
  const normal = getComputedStyle(fill).transitionDuration;
  return { reduced, normal };
});
if (mbReduced) {
  const reducedMs = parseFloat(mbReduced.reduced) * (mbReduced.reduced.includes("ms") ? 1 : 1000);
  const normalMs = parseFloat(mbReduced.normal) * (mbReduced.normal.includes("ms") ? 1 : 1000);
  (reducedMs < 1 && normalMs > 900)
    ? ok("html.reduce-motion collapses .mb-timerfill's transition (normal " + mbReduced.normal + " -> reduced " + mbReduced.reduced + ")")
    : bad("reduce-motion did not collapse .mb-timerfill's transition (normal=" + mbReduced.normal + " reduced=" + mbReduced.reduced + ")");
}

/* ------------------------------------------------------------------ *
 * (6) .quiz-timer-fill - Quiz mode's real per-question countdown. Also
 *     already transform-based before this pass. No visible numeric
 *     readout exists for this one (unlike Mock Board's .mb-timer), so
 *     ground truth here is the fill's own discreteness: real ticks land
 *     on an exact k/20 fraction (QUIZ_SECONDS=20) once per second, so a
 *     poll that finds only clean k/20 values, strictly decreasing, over
 *     several real seconds is real proof of a working per-second
 *     transform-driven countdown - not a rounding artifact or a stuck bar.
 * ------------------------------------------------------------------ */
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(500);
await page.locator("button", { hasText: /^Quiz$/ }).click();
const timerBtn = page.locator("button", { hasText: /Timer:/ });
await timerBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
const timerBtnFound = await timerBtn.count();
timerBtnFound
  ? ok("found Quiz's Timer toggle button")
  : bad("Quiz's Timer toggle button never appeared - renderQuiz may not have finished mounting");
if (timerBtnFound) {
  const label = (await timerBtn.textContent()) || "";
  if (!/On/.test(label)) await timerBtn.click();
  await page.waitForTimeout(200);
  const labelAfter = (await timerBtn.textContent()) || "";
  /On/.test(labelAfter)
    ? ok("Quiz's Timer toggle now reads \"" + labelAfter.trim() + "\" (timed mode on)")
    : bad("Quiz's Timer toggle still reads \"" + labelAfter.trim() + "\" after clicking - timed mode did not turn on");
}
const startQuizBtn = page.locator("button", { hasText: /^Start Quiz$/ });
await startQuizBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
await startQuizBtn.click();
await page.waitForTimeout(300);

const qzInitial = await page.evaluate(() => {
  const fill = document.querySelector(".quiz-timer-fill");
  if (!fill) return null;
  const cs = getComputedStyle(fill);
  return { transitionProperty: cs.transitionProperty, scaleX: window.__scaleOf(fill, "x") };
});
qzInitial
  ? ok("Quiz's .quiz-timer-fill renders on the live timed question")
  : bad("could not find .quiz-timer-fill after starting a timed Quiz question - is Timer mode on?");
if (qzInitial) {
  (qzInitial.transitionProperty.includes("transform") && !/width|height/.test(qzInitial.transitionProperty))
    ? ok(".quiz-timer-fill transitions transform, not width/height (transition-property: " + qzInitial.transitionProperty + ")")
    : bad(".quiz-timer-fill transition-property is \"" + qzInitial.transitionProperty + "\"");
  close(qzInitial.scaleX, 1, 0.001)
    ? ok(".quiz-timer-fill starts a fresh question at scaleX(1) (full bar)")
    : bad(".quiz-timer-fill initial scaleX=" + qzInitial.scaleX + ", expected 1");
}

let qzSamples = [];
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1600);
  const sample = await page.evaluate(() => {
    const fill = document.querySelector(".quiz-timer-fill");
    return fill ? window.__scaleOf(fill, "x") : null;
  });
  if (sample != null) qzSamples.push(sample);
}
qzSamples.length >= 4
  ? ok("collected " + qzSamples.length + " real Quiz timer samples over ~" + (qzSamples.length * 1.6).toFixed(1) + "s")
  : bad("only collected " + qzSamples.length + " Quiz timer samples - expected at least 4 (timer may have stalled or the question auto-advanced)");
// .quiz-timer-fill has the same `transition:transform 1s linear` as
// .mb-timerfill, so (as confirmed above for Mock Board) a sample almost
// never lands on a clean k/20 rest value - it's normally mid-glide between
// two ticks. With no visible numeric readout to cross-check against
// (unlike Mock Board's .mb-timer), ground truth here is the countdown's
// own known rate instead: over QUIZ_SECONDS=20s the fill should lose
// 1/20 = 0.05 of scaleX per real second. Checked as a slope across the
// whole sample run rather than a single point, so timer jitter on any one
// sample can't cause a false failure.
const qzElapsedS = (qzSamples.length - 1) * 1.6;
const qzRate = qzElapsedS > 0 ? (qzSamples[0] - qzSamples[qzSamples.length - 1]) / qzElapsedS : null;
(qzRate != null && close(qzRate, 1 / 20, 0.02))
  ? ok("Quiz's countdown drains scaleX at ~1/20 per real second as expected (observed rate " + qzRate.toFixed(4) + "/s over " + qzElapsedS.toFixed(1) + "s, samples: " + qzSamples.map((s) => s.toFixed(3)).join(", ") + ")")
  : bad("Quiz's countdown rate (" + (qzRate == null ? "n/a" : qzRate.toFixed(4)) + "/s) is not close to the expected 1/20=0.05/s - samples: " + qzSamples.map((s) => s.toFixed(4)).join(", "));
const qzDecreasing = qzSamples.length >= 2 && qzSamples[qzSamples.length - 1] < qzSamples[0];
const qzMonotonic = qzSamples.every((s, i) => i === 0 || s <= qzSamples[i - 1]);
(qzDecreasing && qzMonotonic)
  ? ok("Quiz countdown genuinely progressed over real time (scaleX: " + qzSamples.map((s) => s.toFixed(3)).join(" -> ") + ")")
  : bad("Quiz countdown did not monotonically decrease: " + qzSamples.map((s) => s.toFixed(3)).join(" -> "));

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `FILLBAR-TRANSFORMS: ${fails} FAILURE(S)` : "FILLBAR-TRANSFORMS: all passed"));
process.exit(fails ? 1 : 0);
