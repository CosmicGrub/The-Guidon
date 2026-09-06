/**
 * Route-transition perf gate with seeded data (desktop roadmap, T5).
 *
 * One Chromium; one FRESH context per sample. Each sample seeds the app
 * through G.db.putMany the way a Soldier's device looks after a few months of
 * use - every board card graded, 400 scenario attempts, every lesson studied -
 * reloads so every route renders against real IndexedDB rows, boots on the
 * neutral #/settings route, steps to #/home, applies the CPU throttle, then
 * enters the target route and lets it settle, then re-reads the row counts
 * in-page so a store that did not survive the reload fails loudly instead of
 * sampling an empty database. Every G.routes entry's render()
 * is wrapped in-page to record its wall time, IndexedDB transactions / gets /
 * cursors opened during the render, and DOM nodes produced; a
 * PerformanceObserver collects long tasks and a rAF loop records the largest
 * frame gap while the route settles.
 *
 * Why a fresh context per sample and not per rate: measured on the pre-S1
 * build, the Doctrine layout stall at 4x is 209-244 ms on the FIRST visit in
 * a context and 121-128 ms on every later visit, even after a reload - the
 * browser keeps per-context style/glyph caches warm across reloads - and a
 * context that had already walked #/board and #/dictionary measured it at
 * 184 ms. The budgets were set from cold Home -> route transitions, so that
 * is what the gate samples. Instrumentation itself does not move the number
 * (rAF loop, render wrapper, seeding and boot route were each toggled off
 * with no change beyond noise).
 *
 * Budgets (BUDGETS below) come from the desktop plan, from numbers measured
 * on the day it was written:
 *   1x  no long task >= 50 ms on any route; max rAF gap <= 50 ms per route
 *       (INFORMATIONAL: on the RTX 4050 dev laptop #/board and #/learn sit at
 *       exactly the 50 ms longtask boundary, 50-58 ms cold, so this budget
 *       reports but never blocks; the desktop roadmap's own call is that 4x is
 *       the release gate and 1x is for information)
 *   4x  no long task >= 200 ms on any route (4x ~ a five-year-old barracks
 *       laptop; the Doctrine layout stall only shows up here)
 *   any Home route <= 10 IndexedDB transactions and <= 10 gets
 * A budget is judged against the WORST of a route's PASSES samples.
 *
 * Output: one table per rate (route, wall ms, max task, max gap, tx, gets,
 * nodes), then one PASS/FAIL/INFO line per budget. A FAIL on a blocking
 * budget exits 1 unless --report-only is passed; a non-blocking budget that
 * misses prints INFO and never affects the exit code. There is no CI step for
 * this tool yet (desktop roadmap T10 owns that; the intent is report-only for
 * its first 20 CI runs, then thresholds from the observed variance). A route
 * whose render never completes is always a FAIL.
 *
 * Usage: node tools/perf-routes.mjs [webDir=web] [--report-only]
 *        RATES=1,4 (default) picks the throttle rates, e.g. RATES=4.
 * Not part of the test matrix (perf-*.mjs, run as npm run perf:routes).
 *
 * SEQ is a deliberate subset of G.routes - the routes with seeded data behind
 * them plus the ones a Soldier crosses every session - not a copy of the
 * table: every hash in it is checked against the live G.routes at run time so
 * a renamed route fails loudly instead of silently dropping out. Routes with
 * side effects on entry (#/selftest runs diagnostics, #/kiosk, #/storage
 * estimates quota) are left out on purpose.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

const args = process.argv.slice(2);
const REPORT_ONLY = args.includes("--report-only");
const WEB = resolve(args.find((a) => !a.startsWith("--")) || "web");
const RATES = (process.env.RATES || "1,4").split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 1);
const PASSES = 2;
const ROUTE_TIMEOUT_MS = 60000;
const VIEWPORT = { width: 1280, height: 880 };
const SEQ = ["#/home", "#/board", "#/dictionary", "#/doctrine", "#/library", "#/progress", "#/train",
  "#/learn", "#/search", "#/records", "#/calendar", "#/forms", "#/settings"];

/* rate: the throttle rate the budget applies at, or null for every rate run.
   routes: the hashes it covers, or null for every route walked.
   op "lt": worst value must be < limit; "lte": worst value must be <= limit.
   blocking: false = informational (prints INFO, never fails the run). */
const BUDGETS = [
  { rate: 1, routes: null, metric: "maxTask", op: "lt", limit: 50, blocking: false, label: "no long task >= 50 ms on any route" },
  { rate: 1, routes: null, metric: "maxGap", op: "lte", limit: 50, blocking: false, label: "max rAF gap <= 50 ms on every route" },
  { rate: 4, routes: null, metric: "maxTask", op: "lt", limit: 200, blocking: true, label: "no long task >= 200 ms on any route" },
  { rate: null, routes: ["#/home"], metric: "tx", op: "lte", limit: 10, blocking: true, label: "Home <= 10 IndexedDB transactions" },
  { rate: null, routes: ["#/home"], metric: "gets", op: "lte", limit: 10, blocking: true, label: "Home <= 10 IndexedDB gets" },
];

if (!RATES.length) { console.log("perf-routes: RATES must name at least one rate >= 1"); process.exit(2); }
try { statSync(resolve(WEB, "index.html")); }
catch (e) { console.log("perf-routes: no index.html under " + WEB); process.exit(2); }

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);
const median = (arr) => { const v = arr.slice().sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
const maxOf = (arr) => (arr.length ? Math.max(...arr) : 0);

/* First boot in a context shows the onboarding overlay; a guest session is
   chosen so the app is usable. The choice persists across the reload that
   follows seeding, so that second look only waits briefly (see
   tools/dismiss-onboarding.mjs for the shared dismissal implementation). */

/* Seed through the app's own db layer; counts are whatever the live content
   yields (every board question, every curriculum lesson), never hard-coded. */
async function seed(page) {
  return page.evaluate(async () => {
    const qs = G.store.boardQuestions();
    const srs = qs.map((q, i) => ({ k: "srs:" + q.id, v: { reps: i % 5, ease: 2.3, interval: i % 7, due: Date.now() - (i % 3) * 86400000, misses: i % 4, lastGrade: i % 4 } }));
    await G.db.putMany("kv", srs);
    const scs = G.store.scenarios();
    const DIMS = ["Leads", "Develops", "Achieves", "Character", "Presence", "Intellect"];
    const att = [];
    for (let i = 0; i < 400; i++) {
      const sc = scs[i % scs.length]; const score = {}; DIMS.forEach((d, j) => (score[d] = (i + j) % 5));
      att.push({ id: "seed-" + i, scenarioId: sc.id, title: sc.title || sc.id, mode: "text", score, total: 10, ts: Date.now() - i * 3600000 * 5 });
    }
    await G.db.putMany("attempts", att);
    const cur = G.store.curriculum(); const lessons = [];
    (cur.courses || []).forEach((c) => (c.lessons || []).forEach((l, i) => lessons.push({ k: "curr:" + l.id, v: { studied: true, mastered: i % 2 === 0 } })));
    await G.db.putMany("kv", lessons);
    return { cards: srs.length, attempts: att.length, lessons: lessons.length, kvRows: (await G.db.all("kv")).length };
  });
}

/* In-page instrumentation: IDB counters, a render wrapper on every route,
   a long-task observer and a rAF gap loop. Installed after the post-seed
   reload, so the seeded rows are what every render reads. */
async function instrument(page) {
  await page.evaluate(() => {
    window.__idbTx = 0; window.__idbGet = 0; window.__idbCursor = 0;
    const oTx = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function () { window.__idbTx++; return oTx.apply(this, arguments); };
    const oGet = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function () { window.__idbGet++; return oGet.apply(this, arguments); };
    const oCur = IDBObjectStore.prototype.openCursor; IDBObjectStore.prototype.openCursor = function () { window.__idbCursor++; return oCur.apply(this, arguments); };
    window.__cur = null;
    G.routes.forEach((r) => {
      const orig = r.render;
      r.render = function (m) {
        const t0 = performance.now(), tx0 = window.__idbTx, g0 = window.__idbGet, c0 = window.__idbCursor;
        const cur = window.__cur = { hash: r.hash, done: false };
        return Promise.resolve().then(() => orig.call(this, m)).finally(() => {
          cur.ms = Math.round(performance.now() - t0); cur.tx = window.__idbTx - tx0; cur.gets = window.__idbGet - g0; cur.cursors = window.__idbCursor - c0;
          cur.done = true;
        });
      };
    });
    window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask" });
    window.__gaps = []; let last = performance.now(); const loop = (t) => { window.__gaps.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  });
}

/* Sets the hash and resolves true once the wrapped render has finished, false
   on timeout. Counters are reset first so the sample covers this transition
   only. */
async function enter(page, hash) {
  await page.evaluate((h) => { window.__lt = []; window.__gaps = []; window.__cur = null; location.hash = h; }, hash);
  try { await page.waitForFunction(() => window.__cur && window.__cur.done, null, { timeout: ROUTE_TIMEOUT_MS }); return true; }
  catch (e) { return false; }
}

/* One cold sample of one route in a fresh context (see the header for why).
   Returns { sample | null (render timed out), seeded, errs }. */
async function sampleRoute(browser, url, rate, target) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(600);
    await dismissOnboarding(page, { timeoutMs: 6000 });
    const live = await page.evaluate(() => (window.G && G.routes ? G.routes.map((r) => r.hash) : null));
    if (!live) throw new Error("perf-routes: G.routes is not available after boot at " + url);
    const missing = SEQ.filter((h) => !live.includes(h));
    if (missing.length) throw new Error("perf-routes: SEQ names routes not in G.routes: " + missing.join(", "));
    const seeded = await seed(page);
    if (!seeded.cards || !seeded.lessons) throw new Error("perf-routes: seed produced no rows: " + JSON.stringify(seeded));
    await page.evaluate(() => { location.hash = "#/settings"; });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(600);
    await dismissOnboarding(page, { timeoutMs: 500 });
    await instrument(page);
    if (target !== "#/home") {
      if (!(await enter(page, "#/home"))) return { sample: null, seeded, errs };
      await page.waitForTimeout(400);
    }
    const cdp = await ctx.newCDPSession(page);
    if (rate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.waitForTimeout(300);
    if (!(await enter(page, target))) return { sample: null, seeded, errs };
    await page.waitForTimeout(500 * rate);
    const sample = await page.evaluate(() => ({
      ...window.__cur,
      maxTask: Math.max(0, ...window.__lt),
      maxGap: Math.round(Math.max(0, ...window.__gaps)),
      nodes: document.getElementById("route").getElementsByTagName("*").length,
    }));
    /* Read AFTER the sample, never before it: db.all("kv") is memoised
       in-page, so a raw read ahead of the render would warm that cache and
       understate Home's IndexedDB counts. Home opens the same 9 transactions
       / 7 gets on an EMPTY store (measured), so the IDB budget alone cannot
       tell a seeded run from a wiped one; this check can. */
    const after = await page.evaluate(async () => ({ kvRows: (await G.db.all("kv")).length, attempts: (await G.db.all("attempts")).length }));
    if (after.kvRows < seeded.kvRows || after.attempts !== seeded.attempts) throw new Error("perf-routes: seeded rows did not survive the reload: " + JSON.stringify({ seeded, after }));
    return { sample, seeded, errs };
  } finally {
    await ctx.close();
  }
}

async function walk(browser, url, rate) {
  const rows = {};
  const timeouts = [];
  const errs = [];
  let seeded = null;
  for (let pass = 0; pass < PASSES; pass++) {
    for (const h of SEQ) {
      const r = await sampleRoute(browser, url, rate, h);
      seeded = seeded || r.seeded;
      for (const e of r.errs) if (!errs.includes(e)) errs.push(e);
      if (!r.sample) { timeouts.push(h); continue; }
      if (r.sample.hash !== h) timeouts.push(h + " (render recorded for " + r.sample.hash + ")");
      (rows[h] = rows[h] || []).push(r.sample);
    }
  }
  return { rows, timeouts, errs, seeded };
}

/* Per-route summary: worst sample for the gated metrics, median for the rest. */
function summarize(rows) {
  const out = {};
  for (const h of SEQ) {
    const rs = rows[h] || [];
    if (!rs.length) continue;
    out[h] = {
      n: rs.length,
      ms: median(rs.map((x) => x.ms)),
      maxTask: maxOf(rs.map((x) => x.maxTask)),
      maxGap: maxOf(rs.map((x) => x.maxGap)),
      tx: maxOf(rs.map((x) => x.tx)),
      gets: maxOf(rs.map((x) => x.gets)),
      nodes: median(rs.map((x) => x.nodes)),
    };
  }
  return out;
}

function printTable(sum) {
  console.log(`  ${"route".padEnd(13)} ${"wall(ms)".padStart(8)} ${"maxTask".padStart(8)} ${"maxGap".padStart(7)} ${"tx".padStart(4)} ${"gets".padStart(5)} ${"nodes".padStart(6)}   (worst of n cold samples; wall/nodes median)`);
  for (const h of SEQ) {
    const s = sum[h];
    if (!s) { console.log(`  ${h.padEnd(13)} ${"-".padStart(8)}  (no completed render)`); continue; }
    console.log(`  ${h.padEnd(13)} ${String(s.ms).padStart(8)} ${String(s.maxTask).padStart(8)} ${String(s.maxGap).padStart(7)} ${String(s.tx).padStart(4)} ${String(s.gets).padStart(5)} ${String(s.nodes).padStart(6)}   n=${s.n}`);
  }
}

function judge(rate, sum, timeouts) {
  for (const t of timeouts) bad(`${rate}x: render of ${t} did not complete within ${ROUTE_TIMEOUT_MS / 1000} s`);
  for (const b of BUDGETS) {
    if (b.rate !== null && b.rate !== rate) continue;
    const routes = (b.routes || SEQ).filter((h) => sum[h]);
    if (!routes.length) { bad(`${rate}x: ${b.label} - no route measured`); continue; }
    const offenders = routes.filter((h) => (b.op === "lt" ? !(sum[h][b.metric] < b.limit) : !(sum[h][b.metric] <= b.limit)));
    let worst = routes[0];
    for (const h of routes) if (sum[h][b.metric] > sum[worst][b.metric]) worst = h;
    if (offenders.length) (b.blocking === false ? info : bad)(`${rate}x: ${b.label} - ${offenders.map((h) => `${h} ${b.metric} ${sum[h][b.metric]}`).join(", ")} (limit ${b.limit})${b.blocking === false ? " [informational]" : ""}`);
    else ok(`${rate}x: ${b.label} (worst ${worst} ${b.metric} ${sum[worst][b.metric]}, limit ${b.limit})`);
  }
}

console.log(`perf-routes: ${WEB}  rates=${RATES.join(",")}x  passes=${PASSES}  viewport=${VIEWPORT.width}x${VIEWPORT.height}${REPORT_ONLY ? "  (--report-only)" : ""}`);
const { server, url } = await serve(WEB);
const browser = await chromium.launch();
try {
  for (const rate of RATES) {
    const { rows, timeouts, errs, seeded } = await walk(browser, url, rate);
    const s = seeded || {};
    console.log(`\n=== ${rate}x  seeded cards=${s.cards} attempts=${s.attempts} lessons=${s.lessons} kvRows=${s.kvRows} ===`);
    const sum = summarize(rows);
    printTable(sum);
    if (errs.length) console.log("  WARN  page errors: " + errs.slice(0, 5).join(" | "));
    console.log("");
    judge(rate, sum, timeouts);
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\nperf-routes: ${fails} FAIL${REPORT_ONLY && fails ? " (report-only: exit 0)" : ""}`);
process.exit(fails && !REPORT_ONLY ? 1 : 0);
