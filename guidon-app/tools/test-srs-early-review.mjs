/**
 * The review scheduler does not let an EARLY re-grade lengthen a card's interval.
 *
 * WHY THIS SUITE EXISTS. Spacing is the point of the scheduler, and schedule()
 * used to lengthen a card's interval the same way whether the Soldier reviewed
 * it on schedule or four minutes after the last time: four "Down Cold" taps on
 * one card in one sitting took it from 3 to 165 days, and the default deck did
 * this with no wrap-around at all (it interleaves not-yet-due cards among the new
 * ones, so a Soldier who drills every day inflated each card they met a day or
 * two early). The cards then fell off the due list and Readiness read them as
 * current for months.
 *
 * The fix holds a Know It / Down Cold (grades 2 and 3 only) back when it lands
 * before 80% of the interval has passed: the card keeps its interval, due date,
 * repetitions, ease and misses (the grade itself is still recorded), and the
 * drill says so in one plain sentence. A miss (grade 0 or 1) always applies.
 * The last review time is derived (due - interval), so no new field is stored.
 *
 * Three layers:
 *   1. PROPERTY TESTS on the real schedule() source (extracted from
 *      src/index.html and run in node with a controllable clock), tens of
 *      thousands of random review sequences against a literal copy of the OLD
 *      scheduler: a card reviewed on schedule is byte-for-byte what it was; a
 *      miss always downgrades; an early re-grade never moves the schedule;
 *      intervals never shrink on a recall, never fall below the floor, and never
 *      exceed what the old scheduler would have given.
 *   2. The real public entry point (G.board.noteExternalResult) on seeded rows,
 *      both directions.
 *   3. The real Board Drill UI: two passes over a small category leave every
 *      interval at 3 (it was 11), the default deck on the day after a first
 *      session leaves the cards it re-shows untouched (it jumped them all), the
 *      cue sentence is shown, and an on-schedule card still grows.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { bootApp, ok, bad, check, finish, waitForRoute, until, liveCount, expectNoConsoleNoise } from "./testkit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86400000;
const is = (cond, claim, detail) => check(cond, claim, () => "NOT: " + claim + (detail === undefined ? "" : "  | " + (typeof detail === "function" ? detail() : detail)));

/* =====================================================================
   1. property tests on the real schedule() source
   ===================================================================== */
const html = readFileSync(path.join(HERE, "..", "src", "index.html"), "utf8");
function extractScheduler() {
  const start = html.indexOf("const EARLY_REVIEW_FIFTHS");
  const sig = html.indexOf("function schedule(s, grade) {");
  if (start === -1 || sig === -1 || start > sig) throw new Error("could not find the scheduler block in src/index.html (EARLY_REVIEW_FIFTHS ... function schedule)");
  let i = html.indexOf("{", sig), depth = 0, end = -1;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error("unbalanced braces while extracting schedule()");
  return html.slice(start, end + 1);
}
let clock = 0;
const FakeDate = class extends Date {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
};
const api = new Function("Date", "DAY", extractScheduler() + "\nreturn { schedule, isEarlyReview, earlyReviewCue, EARLY_REVIEW_FIFTHS };")(FakeDate, DAY);

/* A literal copy of the scheduler as it was BEFORE the guard - the reference every
   on-schedule review must still match exactly. */
function oldSchedule(s, grade, now) {
  if (grade === true) grade = 2;
  if (grade === false) grade = 0;
  s.reps = s.reps || 0;
  s.ease = s.ease || 2.3;
  s.interval = s.interval || 0;
  if (grade === 0) {
    s.reps = 0; s.ease = Math.max(1.3, s.ease - 0.3); s.interval = 0; s.due = now; s.misses = (s.misses || 0) + 1;
  } else if (grade === 1) {
    s.reps = Math.max(1, s.reps); s.ease = Math.max(1.3, s.ease - 0.1); s.interval = 1; s.due = now + s.interval * DAY; s.misses = (s.misses || 0) + 0.5;
  } else if (grade === 2) {
    s.reps += 1;
    s.ease = Math.max(Math.min(2.8, s.ease + 0.1), s.ease - 0.3);
    s.interval = s.reps === 1 ? 1 : s.reps === 2 ? 3 : Math.round((s.interval || 3) * s.ease);
    s.due = now + s.interval * DAY;
    s.misses = Math.max(0, (s.misses || 0) - 0.5);
  } else {
    s.reps += 1;
    s.ease = Math.min(3.2, s.ease + 0.2);
    s.interval = s.reps === 1 ? 3 : Math.round((s.interval || 3) * s.ease * 1.3);
    s.due = now + s.interval * DAY;
    s.misses = Math.max(0, (s.misses || 0) - 0.5);
  }
  s.lastGrade = grade;
  return s;
}
const FIELDS = ["reps", "ease", "interval", "due", "misses", "lastGrade"];
const same = (a, b) => FIELDS.every((f) => a[f] === b[f]);
const snap = (r) => ({ reps: r.reps, ease: r.ease, interval: r.interval, due: r.due, misses: r.misses, lastGrade: r.lastGrade });
const fresh = () => ({ reps: 0, ease: 2.3, interval: 0, due: 0, misses: 0 });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

{
  const SEQUENCES = 4000, STEPS = 30;
  const rnd = mulberry32(20261016);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const fails = {};
  const note = (k, detail) => { if (!fails[k]) fails[k] = detail; fails[k + "#"] = (fails[k + "#"] || 0) + 1; };
  const counts = { steps: 0, early: 0, onSchedule: 0, misses: 0, heldRecall: 0, growth: 0 };
  clock = 1.8e12;
  for (let n = 0; n < SEQUENCES; n++) {
    const row = fresh();
    for (let k = 0; k < STEPS; k++) {
      // how long since the last review: same instant, minutes, a random share of the interval, the exact
      // boundary (80% of the interval, and one millisecond short of it), on schedule, or long overdue
      const lastReview = row.lastGrade != null && row.due ? row.due - row.interval * DAY : clock;
      const iv = row.interval * DAY;
      const kind = Math.floor(rnd() * 7);
      let at;
      if (kind === 0) at = clock;
      else if (kind === 1) at = clock + Math.floor(rnd() * 90) * 60000;
      else if (kind === 2) at = iv > 0 ? lastReview + rnd() * 1.6 * iv : clock + rnd() * 3 * DAY;
      else if (kind === 3) at = iv > 0 ? lastReview + (4 * iv) / 5 : clock + DAY;
      else if (kind === 4) at = iv > 0 ? lastReview + (4 * iv) / 5 - 1 : clock + DAY;
      else if (kind === 5) at = iv > 0 ? lastReview + iv : clock + DAY;
      else at = clock + rnd() * 20 * DAY;
      clock = Math.max(clock, Math.floor(at));
      const grade = pick([0, 1, 2, 2, 3, 3, 3]);

      const prior = snap(row);
      const hadGrade = row.lastGrade != null;
      const elapsed = hadGrade && row.interval > 0 && row.due > 0 ? clock - (row.due - row.interval * DAY) : Infinity;
      const expectEarly = (grade === 2 || grade === 3) && hadGrade && row.interval > 0 && row.due > 0 && elapsed * 5 < row.interval * DAY * 4;
      const ref = oldSchedule(Object.assign({}, prior), grade, clock);
      const early = api.isEarlyReview(row, grade, clock);
      const got = api.schedule(row, grade);
      const g = snap(got);
      counts.steps++;

      if (early !== expectEarly) note("isEarlyReview disagrees with the stated rule", JSON.stringify({ prior, grade, clock, early, expectEarly }));
      if (grade === 0) {
        counts.misses++;
        if (!(g.interval === 0 && g.reps === 0 && g.due === clock && g.misses === prior.misses + 1 && g.lastGrade === 0)) note("a Needs Help always downgrades", JSON.stringify({ prior, g }));
      }
      if (grade === 1) {
        counts.misses++;
        if (!(g.interval === 1 && g.due === clock + DAY && g.lastGrade === 1)) note("a Somewhat always downgrades to a day", JSON.stringify({ prior, g }));
      }
      if (expectEarly) {
        counts.early++;
        if (g.reps !== prior.reps || g.ease !== prior.ease || g.interval !== prior.interval || g.due !== prior.due || g.misses !== prior.misses) note("an early recall changes nothing about the schedule", JSON.stringify({ prior, g }));
        if (g.lastGrade !== grade) note("an early recall still records the grade", JSON.stringify({ prior, g, grade }));
        counts.heldRecall++;
      } else {
        counts.onSchedule++;
        if (!same(g, snap(ref))) note("a card reviewed on schedule behaves exactly as the old scheduler", JSON.stringify({ prior, g, ref, grade, clock }));
      }
      // never inflate beyond what the old scheduler would have given, never shrink on a recall, never below the floor
      if (!(g.interval <= ref.interval)) note("an interval never exceeds what the old scheduler gave", JSON.stringify({ prior, g, ref }));
      if ((grade === 2 || grade === 3) && !(g.interval >= prior.interval)) note("a recall never shortens an interval", JSON.stringify({ prior, g, grade }));
      if (grade >= 1 && !(g.interval >= 1)) note("after anything but a miss the interval is at least a day", JSON.stringify({ prior, g }));
      if (!(Number.isInteger(g.interval) && g.interval >= 0 && Number.isFinite(g.due) && g.ease >= 1.3 && g.ease <= 3.2 && g.misses >= 0)) note("fields stay in range", JSON.stringify({ prior, g }));
      if (g.interval > prior.interval) counts.growth++;
    }
  }
  const failed = Object.keys(fails).filter((k) => !k.endsWith("#"));
  failed.forEach((k) => bad("property broken: " + k + " (" + fails[k + "#"] + " times), first: " + fails[k]));
  is(failed.length === 0, "scheduler properties hold over " + counts.steps + " random review steps (" + counts.early + " early recalls, " + counts.onSchedule + " on schedule, " + counts.misses + " misses)");
  is(counts.early > 2000 && counts.growth > 2000 && counts.misses > 2000, "the random sequences really exercised early recalls, growth and misses", JSON.stringify(counts));
}

{
  // a burst of recalls in one sitting leaves the card exactly where a single review would have
  clock = 1.8e12;
  const burst = fresh();
  for (let i = 0; i < 12; i++) { api.schedule(burst, 3); clock += 4 * 60000; }
  const once = oldSchedule(fresh(), 3, 1.8e12);
  is(burst.interval === 3 && burst.reps === 1 && Math.abs(burst.ease - once.ease) < 1e-9 && burst.due === 1.8e12 + 3 * DAY, "twelve Down Cold taps four minutes apart leave one review's result: interval 3, one rep", JSON.stringify(snap(burst)));
  // a Soldier who drills the same card every single day for six weeks: it advances only when it comes due
  clock = 1.8e12;
  const daily = fresh(), oldDaily = fresh();
  const trail = [];
  for (let d = 0; d < 42; d++) {
    api.schedule(daily, 3); oldSchedule(oldDaily, 3, clock);
    if (d % 7 === 6) trail.push(daily.interval);
    clock += DAY;
  }
  is(daily.interval <= 41 && oldDaily.interval >= 165, "drilling a card Down Cold every day for six weeks reaches " + daily.interval + " days (the old scheduler passed 165 days by the fourth review)", JSON.stringify(trail));
  is(daily.interval > 3, "and the card still advances once it is genuinely due (the guard holds, it does not freeze)", JSON.stringify(trail));
}

{
  // the exact 80% boundary, in both directions, on an exact 3-day card
  clock = 1.8e12;
  // elapsedMs since the last review, in whole milliseconds (no floating-point fractions of a day)
  const mk = (elapsedMs) => ({ reps: 1, ease: 2.5, interval: 3, due: clock + 3 * DAY - elapsedMs, misses: 0, lastGrade: 3 });
  const EIGHTY = 4 * 3 * DAY / 5;
  is(EIGHTY === 207360000, "the 80% mark of a three-day interval is a whole number of milliseconds (" + EIGHTY + ")");
  is(api.isEarlyReview(mk(EIGHTY), 3, clock) === false, "exactly 80% of the way through the interval is on time");
  is(api.isEarlyReview(mk(EIGHTY - 1), 3, clock) === true, "one millisecond short of 80% is still early");
  is(api.isEarlyReview(mk(0.1 * 3 * DAY), 3, clock) === true && api.isEarlyReview(mk(1.5 * 3 * DAY), 3, clock) === false, "10% through is early, 150% through (overdue) is on time");
  is(api.isEarlyReview(mk(0.1 * 3 * DAY), 0, clock) === false && api.isEarlyReview(mk(0.1 * 3 * DAY), 1, clock) === false, "a miss is never held back, however early");
  is(api.isEarlyReview({ reps: 0, ease: 2.3, interval: 0, due: 0, misses: 0 }, 3, clock) === false, "a card never graded is never early");
  is(api.isEarlyReview({ reps: 2, ease: 2.3, interval: 5, due: clock + DAY, misses: 0 }, 3, clock) === false, "an older row with no last grade has nothing to compare against, so it is allowed");
  is(api.isEarlyReview({ reps: 2, ease: 2.3, interval: "x", due: NaN, misses: 0, lastGrade: 2 }, 2, clock) === false && api.isEarlyReview(null, 2, clock) === false, "a damaged or missing row is allowed (never throws, never blocks)");
  // a usable interval beside an unusable due date (hand-edited or restored from a damaged backup) must not hold the card back either
  const goodInterval = (due) => ({ reps: 2, ease: 2.3, interval: 5, due, misses: 0, lastGrade: 2 });
  is(api.isEarlyReview(goodInterval(NaN), 3, clock) === false && api.isEarlyReview(goodInterval(0), 3, clock) === false && api.isEarlyReview(goodInterval("soon"), 3, clock) === false && api.isEarlyReview(goodInterval(Infinity), 3, clock) === false, "a row with an interval but no usable due date is allowed (NaN, 0, text, infinity)");
}

{
  // the sentence a Soldier reads when their grade did not move the date
  clock = new Date(2026, 9, 14, 12, 0, 0).getTime(); // a Wednesday, local noon, so +3h is the same calendar day in any zone
  const cue = (ms) => api.earlyReviewCue({ due: clock + ms });
  const wk = (ms) => new Date(clock + ms).toLocaleDateString(undefined, { weekday: "long" });
  is(/^Too soon to change this card's date/.test(cue(3 * 3600000)) && /comes back later today\.$/.test(cue(3 * 3600000)), "due later today reads 'comes back later today'", cue(3 * 3600000));
  is(/comes back tomorrow\.$/.test(cue(DAY)), "due tomorrow reads 'comes back tomorrow'", cue(DAY));
  is(cue(3 * DAY).endsWith("comes back on " + wk(3 * DAY) + "."), "due in three days names the weekday", cue(3 * DAY));
  is(/comes back in 9 days\.$/.test(cue(9 * DAY)), "due in nine days reads 'in 9 days'", cue(9 * DAY));
  is(!/interval|ease|reps|SRS|schedul|algorithm/i.test(cue(3 * DAY)), "and uses no builder words", cue(3 * DAY));
}

/* =====================================================================
   2. the public entry point, on seeded rows (both directions)
   ===================================================================== */
const boot = await bootApp({ viewport: { width: 1280, height: 900 } });
const { page, noise } = boot;
await liveCount(page, { kind: "board" });

const ids = await page.evaluate(() => G.store.boardQuestions().map((q) => q.id));
const seed = (id, row) => page.evaluate(async ([id, row]) => { await G.db.put("kv", { k: "srs:" + id, v: row }); }, [id, row]);
const readRow = (id) => page.evaluate(async (id) => { const r = await G.db.get("kv", "srs:" + id); return r ? r.v : null; }, id);
const grade = (id, g) => page.evaluate(async ([id, g]) => G.board.noteExternalResult(id, g), [id, g]);
const clearSrs = () => page.evaluate(async () => {
  const rows = await G.db.all("kv");
  for (const r of rows) if (r && typeof r.k === "string" && r.k.indexOf("srs:") === 0) await G.db.del("kv", r.k);
});
const nowMs = () => page.evaluate(() => Date.now());

{
  await clearSrs();
  const a = ids[0];
  const r1 = await grade(a, 3), r2 = await grade(a, 3);
  is(r1.interval === 3 && r1.reps === 1 && r2.interval === 3 && r2.reps === 1, "two Down Cold grades in a row on a fresh card leave interval 3 and one rep", JSON.stringify([r1, r2]));
  const r3 = await grade(a, 2);
  is(r3.interval === 3 && r3.reps === 1 && r3.lastGrade === 2 && r3.due === r1.due, "a Know It straight after keeps the date and records the grade", JSON.stringify(r3));

  // one day into a three day interval: held; 0.4 day left (2.6 of 3 days gone): grows
  const b = ids[1], c = ids[2];
  const t = await nowMs();
  await seed(b, { reps: 1, ease: 2.5, interval: 3, due: t + 2 * DAY, misses: 0, lastGrade: 3 });
  await seed(c, { reps: 1, ease: 2.5, interval: 3, due: t + 0.4 * DAY, misses: 0, lastGrade: 3 });
  const rb = await grade(b, 3), rc = await grade(c, 3);
  is(rb.interval === 3 && rb.reps === 1 && rb.due === t + 2 * DAY && rb.ease === 2.5, "one day into a three-day interval, a Down Cold changes nothing", JSON.stringify(rb));
  is(rc.interval === 11 && rc.reps === 2, "with 0.4 day left (2.6 of 3 days gone) a Down Cold lengthens it as before (11 days, two reps)", JSON.stringify(rc));

  // a miss always applies
  const d = ids[3], e = ids[4];
  await seed(d, { reps: 3, ease: 2.6, interval: 30, due: (await nowMs()) + 29 * DAY, misses: 0, lastGrade: 3 });
  await seed(e, { reps: 3, ease: 2.6, interval: 30, due: (await nowMs()) + 29 * DAY, misses: 0, lastGrade: 3 });
  const rd = await grade(d, 0), re = await grade(e, 1);
  is(rd.interval === 0 && rd.reps === 0 && rd.misses === 1, "Needs Help a day after a 30-day review sends the card straight back (due now)", JSON.stringify(rd));
  is(re.interval === 1 && re.misses === 0.5, "Somewhat a day after a 30-day review makes it a one-day card", JSON.stringify(re));

  // the learning step: a Somewhat card re-shown minutes later and graded Know It stays a one-day card; once due it moves on
  const f = ids[5];
  await grade(f, 1);
  const rf = await grade(f, 2);
  is(rf.interval === 1 && rf.reps === 1 && rf.lastGrade === 2, "a Somewhat card graded Know It minutes later stays a one-day card (this is the change from the old two-rep, three-day jump)", JSON.stringify(rf));
  await seed(f, Object.assign({}, rf, { due: (await nowMs()) - 1000 }));
  const rf2 = await grade(f, 2);
  is(rf2.reps === 2 && rf2.interval === 3, "and graded again once it is due it moves on to three days as before", JSON.stringify(rf2));

  // honest path: an overdue card behaves exactly as it always did
  const g = ids[6];
  await seed(g, { reps: 1, ease: 2.5, interval: 3, due: (await nowMs()) - 1000, misses: 0, lastGrade: 3 });
  const rg = await grade(g, 3);
  is(rg.reps === 2 && rg.interval === 11, "an overdue card graded Down Cold grows exactly as before (11 days, two reps)", JSON.stringify(rg));
  // an older row with no last grade (nothing to compare against) is allowed
  const h = ids[7];
  await seed(h, { reps: 2, ease: 2.3, interval: 5, due: (await nowMs()) + 4 * DAY, misses: 0 });
  const rh = await grade(h, 3);
  is(rh.reps === 3 && rh.interval > 5, "an older row with no last grade is not held back", JSON.stringify(rh));
  // the missed card path from the learning queue: a miss then a recall in the same sitting grows normally (due = now)
  const k = ids[8];
  await grade(k, 0);
  const rk = await grade(k, 3);
  is(rk.reps === 1 && rk.interval === 3, "a card just missed and recalled straight away still moves to three days (a missed card is due now)", JSON.stringify(rk));
  await clearSrs();
}

/* =====================================================================
   3. the real Board Drill
   ===================================================================== */
/* A spy on the app's own on-device writes of review rows, so each step below knows exactly which cards the
   drill graded (the drill, not the test, decides which cards it shows). Installed once, passes writes straight through. */
await page.evaluate(() => {
  window.__srsWrites = [];
  const real = G.db.put.bind(G.db);
  G.db.put = (store, row) => { if (store === "kv" && row && typeof row.k === "string" && row.k.indexOf("srs:") === 0 && window.__srsWrites) window.__srsWrites.push(row.k.slice(4)); return real(store, row); };
});
const mark = () => page.evaluate(() => window.__srsWrites.length);
const writtenSince = (m) => page.evaluate((m) => [...new Set(window.__srsWrites.slice(m))], m);
const queueLength = () => page.evaluate(() => {
  const s = [...document.querySelectorAll(".stat")].find((x) => /This session/.test(x.textContent));
  const m = s && /Card (\d+)\/(\d+)/.exec(s.textContent);
  return m ? +m[2] : -1;
});
const seenCount = () => page.evaluate(() => {
  const s = [...document.querySelectorAll(".stat")].find((x) => /This session/.test(x.textContent));
  const m = s && /recalled (\d+)\/(\d+)/.exec(s.textContent);
  return m ? +m[2] : -1;
});
async function gradeCard(level) {
  const before = await seenCount();
  await page.focus(".qz-wrap");
  await page.keyboard.press("Space");
  if (!(await until(page, () => !!document.querySelector(".qz-card.flipped"), null))) throw new Error("the card never flipped");
  await page.evaluate((lv) => { document.querySelector(".qz-grade-btn.qz-grade-" + lv).click(); }, level);
  if (!(await until(page, (b) => {
    const s = [...document.querySelectorAll(".stat")].find((x) => /This session/.test(x.textContent));
    const m = s && /recalled (\d+)\/(\d+)/.exec(s.textContent);
    return !!m && +m[2] > b;
  }, before))) throw new Error("the drill never moved on after a grade");
}
const toastNow = () => page.evaluate(() => { const t = document.getElementById("toast"); return t && t.classList.contains("show") ? t.textContent : ""; });
// A toast stays up for a few seconds, so start every "no sentence is shown" step from a clean slate
const clearToast = () => page.evaluate(() => { const t = document.getElementById("toast"); if (t) { t.classList.remove("show"); t.textContent = ""; } });
const CUE = /Too soon to change this card's date — it still comes back (later today|tomorrow|on [^.]+|in \d+ days)\./;
const rowsOf = (list) => page.evaluate(async (list) => { const out = {}; for (const id of list) { const r = await G.db.get("kv", "srs:" + id); out[id] = r ? r.v : null; } return out; }, list);

const smallCat = await page.evaluate(() => {
  const by = {};
  G.store.boardQuestions().forEach((q) => { (by[q.category] = by[q.category] || []).push(q.id); });
  const names = Object.keys(by).filter((c) => by[c].length >= 3 && by[c].length <= 8).sort((a, b) => by[a].length - by[b].length || (a < b ? -1 : 1));
  return names.length ? names[0] : null;
});
is(!!smallCat, "the bank has a small category (3 to 8 cards) to drill two passes over", () => "none found");

if (smallCat) {
  const openCategory = async () => {
    await page.evaluate((cat) => { G.board._filterCat = cat; }, smallCat);
    await waitForRoute(page, "#/board", { fresh: true, ready: ".qz-wrap" });
    await until(page, () => !!document.querySelector(".qz-card"), null);
    return queueLength();
  };

  // two passes of Down Cold over the same cards in one sitting
  await clearSrs();
  let n = await openCategory();
  is(n >= 3 && n <= 8, "the drill opened " + JSON.stringify(smallCat) + " with " + n + " cards", () => String(n));
  let m0 = await mark();
  await clearToast();
  for (let i = 0; i < n; i++) await gradeCard(3);
  const pass1 = await writtenSince(m0);
  is(pass1.length === n, "pass one graded each of the " + n + " cards once", JSON.stringify(pass1));
  is(!CUE.test(await toastNow()), "first pass: grading a card for the first time shows no 'too soon' sentence", await toastNow());
  const afterOne = await rowsOf(pass1);
  is(pass1.every((id) => afterOne[id] && afterOne[id].interval === 3 && afterOne[id].reps === 1), "after one pass every card is at interval 3, one rep", JSON.stringify(afterOne));
  m0 = await mark();
  await clearToast();
  await gradeCard(3);
  // the sentence is a one-time explanation: shown at the first held-back grade of the sitting...
  const firstCue = CUE.test(await toastNow());
  await clearToast();
  for (let i = 1; i < n; i++) await gradeCard(3);
  // ...and not repeated for every other card in the same sitting
  const laterCue = CUE.test(await toastNow());
  const pass2 = await writtenSince(m0);
  is(pass2.length === n && pass2.every((id) => pass1.includes(id)), "pass two came back round to the same " + n + " cards", JSON.stringify(pass2));
  const afterTwo = await rowsOf(pass1);
  is(pass1.every((id) => afterTwo[id] && afterTwo[id].interval === 3 && afterTwo[id].reps === 1 && afterTwo[id].due === afterOne[id].due), "after a SECOND pass in the same sitting every interval is still 3 (it was 11) and no due date moved", JSON.stringify(afterTwo));
  is(firstCue, "the drill tells the Soldier why the date did not change, in a plain sentence (at the first card held back)", () => "no sentence after the first early grade");
  is(!laterCue, "...once: grading " + (n - 1) + " more held-back cards in the same sitting does not repeat it", () => JSON.stringify(laterCue));

  // Somewhat, then Know It on the same card in the same sitting, is a relearn: the drill asked for it, so no "too soon"
  await clearSrs();
  n = await openCategory();
  await clearToast();
  const firstPrompt = await page.evaluate(() => (document.querySelector(".qz-prompt") || {}).textContent || "");
  await gradeCard(1);
  const promptNow = () => page.evaluate(() => (document.querySelector(".qz-prompt") || {}).textContent || "");
  for (let guard = 0; guard < 2 * n + 4 && (await promptNow()) !== firstPrompt; guard++) await gradeCard(3);
  const cameBack = (await promptNow()) === firstPrompt;
  is(cameBack, "fixture: the card marked Somewhat came back later in the same sitting", () => "it never came back");
  await clearToast();
  m0 = await mark();
  await gradeCard(2);
  const relearned = await writtenSince(m0);
  const relearnRows = await rowsOf(relearned);
  const relearnToast = await toastNow();
  is(!CUE.test(relearnToast), "marking it Know It a few minutes later shows no 'too soon' sentence (the drill itself asked for the repeat)", () => JSON.stringify(relearnToast));
  is(relearned.length === 1 && relearnRows[relearned[0]].interval === 1 && relearnRows[relearned[0]].reps === 1, "...and the schedule is unchanged by that: the card still comes back in 1 day, one rep", () => JSON.stringify(relearnRows));

  // honest direction: the same cards, now overdue, DO advance when graded Down Cold
  await clearSrs();
  n = await openCategory();
  m0 = await mark();
  for (let i = 0; i < n; i++) await gradeCard(3);
  const ids1 = await writtenSince(m0);
  // make every one of them due, then drill the category again: this is a Soldier coming back on the day it is due
  const t0 = await nowMs();
  for (const id of ids1) await seed(id, { reps: 1, ease: 2.5, interval: 3, due: t0 - 1000, misses: 0, lastGrade: 3 });
  await openCategory();
  m0 = await mark();
  await clearToast();
  for (let i = 0; i < n; i++) await gradeCard(3);
  const ids2 = await writtenSince(m0);
  const overdueDone = await rowsOf(ids2);
  is(ids2.length === n && ids2.every((id) => overdueDone[id] && overdueDone[id].reps === 2 && overdueDone[id].interval === 11), "cards that really were due advance as before (11 days, two reps)", JSON.stringify(overdueDone));
  is(!CUE.test(await toastNow()), "and no 'too soon' sentence is shown for a card that was due", await toastNow());

  // a miss in the second pass still lands, however early
  await clearSrs();
  n = await openCategory();
  for (let i = 0; i < n; i++) await gradeCard(3);
  m0 = await mark();
  await gradeCard(0);
  const missed = await writtenSince(m0);
  const afterMiss = await rowsOf(missed);
  is(missed.length === 1 && afterMiss[missed[0]].interval === 0 && afterMiss[missed[0]].reps === 0 && afterMiss[missed[0]].misses === 1, "a Needs Help graded right after a Down Cold still sends the card back (due now)", JSON.stringify(afterMiss));
}

/* the default deck on the day after a first session: the cards it re-shows early are left alone */
{
  await clearSrs();
  const t = await nowMs();
  const early = ids.slice(0, 60);
  for (const id of early) await seed(id, { reps: 1, ease: 2.5, interval: 3, due: t + 2 * DAY, misses: 0, lastGrade: 3 });
  await waitForRoute(page, "#/board", { fresh: true, ready: ".qz-wrap" });
  await until(page, () => !!document.querySelector(".qz-card"), null);
  const m0 = await mark();
  for (let i = 0; i < 20; i++) await gradeCard(3);
  const written = await writtenSince(m0);
  const touchedEarly = written.filter((id) => early.includes(id));
  is(touchedEarly.length >= 5, "the default deck really did re-show not-yet-due cards among the new ones (" + touchedEarly.length + " of " + written.length + ")", JSON.stringify(written));
  const rows = await rowsOf(early);
  const moved = early.filter((id) => !(rows[id] && rows[id].interval === 3 && rows[id].reps === 1 && rows[id].due === t + 2 * DAY));
  is(moved.length === 0, "none of the 60 cards graded a day earlier jumped (they all still read interval 3, one rep, the same due date)", () => moved.length + " moved: " + JSON.stringify(rows[moved[0]]));
  const newOnes = written.filter((id) => !early.includes(id));
  const newRows = await rowsOf(newOnes);
  is(newOnes.length >= 5 && newOnes.every((id) => newRows[id] && newRows[id].interval === 3 && newRows[id].reps === 1), "while the new cards in the same sitting were scheduled normally (" + newOnes.length + " at interval 3, one rep)", () => JSON.stringify(newRows));
  await clearSrs();
}

expectNoConsoleNoise(noise);
await finish("SRS EARLY REVIEW");
