/**
 * Cross-context sync verifier (desktop roadmap, T7) - written BEFORE the
 * cross-window bus exists, so its first runs are the RED baseline the bus
 * has to turn green.
 *
 * Two pages A and B share one browser context, so one IndexedDB (a Soldier
 * with two GUIDON tabs, or the PWA next to a Tauri window). Measured on the
 * pre-bus build (Session 1, both engines): wrapKvCache() memoises
 * db.all("kv") per page and only that page's own writes clear it, so A's
 * cached read never sees B's put; the store's debounced settings save
 * writes the WHOLE state.settings row, so two pages editing different keys
 * overwrite each other's values; Home's due count is computed on render
 * only, so B's Home stays stale after A grades cards; util.emit is
 * in-process, so B never hears A's "scenarios:change"; nothing crosses
 * the context boundary at all.
 *
 * Every case is measured through the live G.db / G.store / G.routes /
 * G.theme objects (tools/xwin-harness.mjs), and every positive assertion is
 * a bounded poll (up to POLL_MAX ms, 50 ms steps) that records how long the
 * value took to arrive - never a bare sleep followed by a read. "within N
 * ms" means the poll hit inside N ms; a hit after N is still a FAIL, with
 * the observed latency in the line.
 *
 * Cases (letters are the roadmap's):
 *   (a) B's db.put("kv") visible in A's db.all("kv") within 500 ms
 *   (b) A sets userName, 450 ms later B sets navDensity: the settings row
 *       read fresh from IndexedDB holds BOTH
 *   (g) the in-flight race: A sets userName at t=0, B sets navDensity at
 *       t=100 (A's whole-row write lands at ~300 ms while B's debounce is
 *       still pending): the row holds both AND B's live navDensity is kept
 *   (c) A seeds 30 due SRS rows via db.putMany; B's Home due card (as
 *       rendered in the DOM) rises by 30 within 500 ms plus the measured
 *       cost of the uncached kv re-scan that render has to pay (an engine
 *       IndexedDB cost, ~0 ms in Chromium, hundreds of ms in Playwright's
 *       WebKit on Windows - see the case's own comment)
 *   (d) A saves a user scenario through store.saveUserScenario(); B's
 *       store.userScenarios() lists its id within 500 ms
 *   (h) A sets the theme; B's <html data-theme> equals it within 500 ms
 *   (f) A does one db.putMany("kv", 900 rows) while B is on #/home: B's
 *       Home render count (wrapped through G.routes, perf-routes style)
 *       must be <= 2 within 1000 ms; B's long tasks are recorded
 *   (e) zero page errors and zero console errors on both pages, whole run
 *   (j) one write from A puts EXACTLY one message on the "guidon:store"
 *       channel (a probe BroadcastChannel on B counts them for 600 ms): a
 *       receipt that posted back would echo between the pages forever
 *   (i) receipt never writes: with the write counter on B, everything A
 *       did produced ZERO db write calls on B. B's own explicit writes
 *       ((a)'s put and the one debounced settings put per B edit in (b)
 *       and (g)) are the only entries excused; anything else is a receipt
 *       write and counts against this case.
 *
 * Usage: node tools/test-xwin-sync.mjs [webDir=web]
 *        PW_BROWSER=webkit selects WebKit (one browser either way).
 * Output: PASS/FAIL/INFO lines; exit code = number of FAIL lines.
 */
import { serve } from "./server.mjs";
import { openPair, settleAfter, longTasks, dueCard, writeCounter, close, ENGINE } from "./xwin-harness.mjs";
import { resolve } from "node:path";
import { statSync } from "node:fs";

const WEB = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || "web");
try { statSync(resolve(WEB, "index.html")); }
catch (e) { console.log("test-xwin-sync: no index.html under " + WEB); process.exit(2); }

const POLL_MAX = 1500;
const POLL_STEP = 50;
const SEED_DUE = 30;
const BURST_ROWS = 900;
/* Watchdog: a bus whose receipt posts back floods both pages with an
   endless ping-pong (measured: an echo-on-receipt mutant starved the
   pages' evaluate() calls and this suite ran past 10 minutes with no
   verdict). Every poll here is bounded, so a healthy run is ~40 s per
   engine; a run past WATCHDOG_MS is itself a FAIL, reported and exited
   rather than hung. Playwright kills the browser on process exit. */
const WATCHDOG_MS = 180000;
setTimeout(() => {
  console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms - the pages are not responding (a receipt echo storm?)");
  console.log("\nXWIN SYNC: WATCHDOG TIMEOUT");
  process.exit(99);
}, WATCHDOG_MS).unref();

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Bounded poll: resolves { hit, ms, value } - hit once pred() is truthy,
   otherwise after limit ms with the last value seen. */
async function until(pred, limit = POLL_MAX, step = POLL_STEP) {
  const t0 = Date.now();
  for (;;) {
    const value = await pred();
    if (value) return { hit: true, ms: Date.now() - t0, value };
    if (Date.now() - t0 >= limit) return { hit: false, ms: Date.now() - t0, value };
    await sleep(step);
  }
}
function within(label, r, budget, detail) {
  const d = detail ? " - " + detail : "";
  if (r.hit && r.ms <= budget) ok(label + " (arrived in " + r.ms + " ms, budget " + budget + ")" + d);
  else if (r.hit) bad(label + " - arrived LATE after " + r.ms + " ms (budget " + budget + ")" + d);
  else bad(label + " - never arrived within " + r.ms + " ms" + d);
}

/* Receipt-write accounting on B (case (i)): every case records the write
   log delta on B across its A-action window and the entries B's OWN
   explicit action is expected to have produced; the remainder are receipt
   writes. */
const receipts = [];
async function bWrites(B, since) { return (await writeCounter(B)).slice(since); }
function account(caseId, entries, own) {
  const rest = entries.slice();
  for (const o of own) {
    const i = rest.findIndex((e) => e.op === o.op && e.store === o.store && e.key === o.key);
    if (i !== -1) rest.splice(i, 1);
  }
  receipts.push({ caseId, entries, own, receipt: rest });
  info("(" + caseId + ") B write calls in window: " + entries.length + " (" + entries.map((e) => e.op + " " + e.store + "/" + e.key).join(", ") + "); B's own expected: " + own.length + "; receipt writes: " + rest.length);
  return rest.length;
}

console.log("test-xwin-sync: " + WEB + "  engine=" + ENGINE + "  poll<=" + POLL_MAX + "ms");
const { server, url } = await serve(WEB);
let pair = null;
try {
  pair = await openPair(url, { hashA: "#/home", hashB: "#/home" });
  const { A, B, noise } = pair;

  /* Harness guard: a second openPair must throw, and no second browser
     may appear. Checked once, up front. */
  let guardThrew = null;
  try { await openPair(url); } catch (e) { guardThrew = e.message; }
  guardThrew && /already open/.test(guardThrew) ? ok("harness refuses a second browser while one is open (" + guardThrew + ")") : bad("harness guard did not throw: " + guardThrew);

  /* Both pages sit on #/home; B's first Home render already did its
     once-a-day streak write, so the write counter installed now only sees
     what happens from here on. The long-task observer goes in the same way. */
  await settleAfter(A, 300);
  await settleAfter(B, 300);
  const hashes = { A: await A.evaluate(() => location.hash), B: await B.evaluate(() => location.hash) };
  hashes.A === "#/home" && hashes.B === "#/home" ? ok("A and B both booted past onboarding on #/home at " + url) : bad("boot hashes: " + JSON.stringify(hashes));
  /* The engine PW_BROWSER selected must be the engine that actually ran:
     Chromium's UA carries "Chrome/" (and "Safari/"), WebKit's only "Safari/". */
  const ua = await A.evaluate(() => navigator.userAgent);
  const uaEngine = /Chrome\//.test(ua) ? "chromium" : /Safari\//.test(ua) ? "webkit" : "unknown";
  uaEngine === ENGINE ? ok("engine " + ENGINE + " confirmed by navigator.userAgent: " + ua) : bad("engine mismatch: PW_BROWSER selected " + ENGINE + " but navigator.userAgent is " + ua);
  const lt0 = await longTasks(B);
  info("B long-task observer: " + (lt0.supported ? "installed" : "NOT supported by this engine (durations stay empty)"));
  const writes0 = (await writeCounter(B)).length;
  info("B write counter installed after boot; " + writes0 + " entries at install (expected 0)");

  /* ======== (a) B's kv put visible in A's cached db.all("kv") ======== */
  {
    const warm = await A.evaluate(async () => (await G.db.all("kv")).length);
    info("(a) A warmed its kv cache: db.all(\"kv\") = " + warm + " rows");
    const w0 = (await writeCounter(B)).length;
    await B.evaluate(() => G.db.put("kv", { k: "xwin:probe", v: 1 }));
    const r = await until(() => A.evaluate(async () => (await G.db.all("kv")).some((row) => row.k === "xwin:probe")));
    const viaGet = await A.evaluate(async () => { const row = await G.db.get("kv", "xwin:probe"); return row ? row.v : null; });
    within("(a) B's db.put(\"kv\", xwin:probe) is visible in A's db.all(\"kv\")", r, 500, "A's db.get(\"kv\",\"xwin:probe\") meanwhile returns " + JSON.stringify(viaGet));
    account("a", await bWrites(B, w0), [{ op: "put", store: "kv", key: "xwin:probe" }]);
  }

  /* ======== (j) one write, exactly one message on the channel ======== */
  {
    /* A probe BroadcastChannel on B hears every "guidon:store" message in
       the context except ones its own object posts - so it sees A's post
       AND anything B's bus would echo back. A receipt that re-posts loops
       forever; the count after one write must be exactly 1. */
    const w0 = (await writeCounter(B)).length;
    await B.evaluate(() => {
      window.__xwinProbe = [];
      const c = new BroadcastChannel("guidon:store");
      c.addEventListener("message", (ev) => { window.__xwinProbe.push(ev.data); });
      window.__xwinProbeChan = c;
    });
    await A.evaluate(() => G.db.put("kv", { k: "xwin:count", v: 1 }));
    const r = await until(() => B.evaluate(() => window.__xwinProbe.length), 500);
    await sleep(600);
    const msgs = await B.evaluate(() => { const m = window.__xwinProbe.slice(); window.__xwinProbeChan.close(); return m; });
    r.hit ? ok("(j) B's probe channel heard A's single db.put in " + r.ms + " ms") : bad("(j) B's probe channel heard nothing within " + r.ms + " ms of A's db.put - nothing is posting on guidon:store");
    msgs.length === 1
      ? ok("(j) exactly 1 message on guidon:store 600 ms after ONE write: " + JSON.stringify(msgs[0]))
      : bad("(j) " + msgs.length + " message(s) on guidon:store after ONE write, expected exactly 1 (a receipt that posts echoes forever): " + JSON.stringify(msgs.slice(0, 4)));
    const m0 = msgs[0];
    const shape = m0 && m0.store === "kv" && Array.isArray(m0.keys) && m0.keys.length === 1 && m0.keys[0] === "xwin:count" && typeof m0.from === "string" && m0.from.length > 0;
    shape ? ok("(j) message shape is { store: \"kv\", keys: [\"xwin:count\"], from: <origin id> }") : bad("(j) message shape unexpected: " + JSON.stringify(m0));
    account("j", await bWrites(B, w0), []);
  }

  /* ======== (b) two pages edit different settings keys 450 ms apart ======== */
  const dens = await B.evaluate(() => ({ cur: G.store.settings().navDensity, all: G.theme.PREF_ENUMS.navDensity.slice() }));
  const DEFAULT_DENSITY = dens.cur;
  const X = dens.all.find((v) => v !== DEFAULT_DENSITY);
  info("navDensity enum " + JSON.stringify(dens.all) + "; fresh-profile value " + JSON.stringify(DEFAULT_DENSITY) + "; non-default X = " + JSON.stringify(X));
  X ? ok("a non-default navDensity value exists to write") : bad("no non-default navDensity value in " + JSON.stringify(dens.all));
  {
    const w0 = (await writeCounter(B)).length;
    await A.evaluate(() => G.store.setSetting("userName", "ALPHA"));
    await sleep(420);
    const aWindow = await bWrites(B, w0);
    account("b", aWindow, []);
    await sleep(30);
    const w1 = (await writeCounter(B)).length;
    await B.evaluate((x) => G.store.setSetting("navDensity", x), X);
    const r = await until(() => A.evaluate(async (x) => { const row = await G.db.get("kv", "settings"); const v = row && row.v; return v && v.userName === "ALPHA" && v.navDensity === x ? v : null; }, X), POLL_MAX);
    const finalRow = await A.evaluate(async () => { const row = await G.db.get("kv", "settings"); return row && row.v ? { userName: row.v.userName, navDensity: row.v.navDensity } : null; });
    finalRow && finalRow.userName === "ALPHA" && finalRow.navDensity === X
      ? ok("(b) settings row read fresh from IndexedDB holds BOTH userName=ALPHA and navDensity=" + X + " after " + (r.ms + 450) + " ms")
      : bad("(b) settings row after both edits (read fresh via db.get): " + JSON.stringify(finalRow) + " - expected userName=ALPHA and navDensity=" + X);
    const bOwn = await bWrites(B, w1);
    info("(b) B's own edit window: " + bOwn.length + " write call(s) (" + bOwn.map((e) => e.op + " " + e.store + "/" + e.key).join(", ") + "), one settings put expected");
    account("b-own", bOwn, [{ op: "put", store: "kv", key: "settings" }]);
  }

  /* ======== (g) the in-flight race ======== */
  {
    /* Reset to a known row: both pages write the defaults and flush. */
    await A.evaluate((d) => { G.store.setSetting("userName", ""); G.store.setSetting("navDensity", d); }, DEFAULT_DENSITY);
    await sleep(500);
    await B.evaluate((d) => { G.store.setSetting("userName", ""); G.store.setSetting("navDensity", d); }, DEFAULT_DENSITY);
    await sleep(700);
    const reset = await A.evaluate(async () => { const row = await G.db.get("kv", "settings"); return row && row.v ? { userName: row.v.userName, navDensity: row.v.navDensity } : null; });
    info("(g) row after reset: " + JSON.stringify(reset));
    const w0 = (await writeCounter(B)).length;
    await A.evaluate(() => G.store.setSetting("userName", "BRAVO"));
    await sleep(100);
    await B.evaluate((x) => G.store.setSetting("navDensity", x), X);
    const r = await until(() => A.evaluate(async (x) => { const row = await G.db.get("kv", "settings"); const v = row && row.v; return v && v.userName === "BRAVO" && v.navDensity === x ? v : null; }, X), POLL_MAX);
    await sleep(Math.max(0, 1500 - r.ms));
    const finalRow = await A.evaluate(async () => { const row = await G.db.get("kv", "settings"); return row && row.v ? { userName: row.v.userName, navDensity: row.v.navDensity } : null; });
    const bLive = await B.evaluate(() => G.store.settings().navDensity);
    const aLive = await A.evaluate(() => ({ userName: G.store.settings().userName, navDensity: G.store.settings().navDensity }));
    finalRow && finalRow.userName === "BRAVO" && finalRow.navDensity === X
      ? ok("(g) after the race the fresh settings row holds userName=BRAVO AND navDensity=" + X)
      : bad("(g) after the race the fresh settings row is " + JSON.stringify(finalRow) + " - expected userName=BRAVO and navDensity=" + X + " (A live: " + JSON.stringify(aLive) + ")");
    bLive === X ? ok("(g) B's live G.store.settings().navDensity is still " + X) : bad("(g) B's live navDensity is " + JSON.stringify(bLive) + ", expected " + X);
    account("g", await bWrites(B, w0), [{ op: "put", store: "kv", key: "settings" }]);
  }

  /* ======== (c) A seeds due SRS rows; B's Home due card ======== */
  {
    await B.evaluate(() => { location.hash = "#/home"; });
    await settleAfter(B, 400);
    const before = await dueCard(B);
    before ? ok("(c) B's Home shows the board-cards card before seeding: " + JSON.stringify(before.text)) : bad("(c) B's Home shows no board-cards card before seeding (hash " + (await B.evaluate(() => location.hash)) + ")");
    /* Warm B's kv cache on purpose: B's own settings put in (g) cleared it,
       and assigning the hash B is already on fires no hashchange (no
       re-render, no db.all). Cold, this case passes even when receipt
       never invalidates - measured against a no-invalidate mutant - so the
       due count below must be computed from a WARM, stale-unless-
       invalidated cache to prove anything. */
    const warmB = await B.evaluate(async () => (await G.db.all("kv")).length);
    info("(c) B warmed its kv cache before the seed: db.all(\"kv\") = " + warmB + " rows");
    const w0 = (await writeCounter(B)).length;
    const seeded = await A.evaluate(async (n) => {
      const qs = (G.store.boardQuestions() || []).slice(0, n);
      const now = Date.now();
      await G.db.putMany("kv", qs.map((q, i) => ({ k: "srs:" + q.id, v: { reps: 2, ease: 2.3, interval: 3, due: now - 60000 - i, misses: 0, lastGrade: 2 } })));
      return qs.length;
    }, SEED_DUE);
    seeded === SEED_DUE ? ok("(c) A seeded " + seeded + " real board questions as due via db.putMany") : bad("(c) A seeded " + seeded + " rows, expected " + SEED_DUE);
    const want = (before ? before.due : 0) + seeded;
    const r = await until(async () => { const c = await dueCard(B); return c && c.due === want ? c : null; });
    const after = await dueCard(B);
    /* B's Home re-render has to re-scan the kv store uncached (the receipt
       invalidated the cache - that is the point). Playwright's WebKit on
       Windows steps an IndexedDB cursor at ~14 ms per row (measured: the
       same 30-row seed took A 430 ms to write there and 1.4 ms in
       Chromium; the bus receipt landed 1 ms after either write), so that
       one scan alone eats most of the 500 ms in WebKit. Measure the exact
       scan the render just paid for and allow it on top of the budget, so
       the case times the bus + render and not the engine's IDB step cost.
       Chromium's scan is ~0 ms, so its budget is the bare 500. */
    const rescan = await B.evaluate(async () => { G.db._invalidateKvCache(); const s = performance.now(); const n = (await G.db.all("kv")).length; return { ms: Math.round(performance.now() - s), n }; });
    info("(c) B's uncached db.all(\"kv\") re-scan of " + rescan.n + " rows costs " + rescan.ms + " ms in " + ENGINE + " - allowed on top of the 500 ms budget");
    within("(c) B's Home due card rose by " + seeded + " (" + (before ? before.due : "none") + " -> " + want + ")", r, 500 + rescan.ms, "B shows " + JSON.stringify(after && after.text));
    account("c", await bWrites(B, w0), []);
  }

  /* ======== (d) A saves a user scenario; B's store lists it ======== */
  {
    const id = "xwin-sc-" + Date.now();
    const w0 = (await writeCounter(B)).length;
    await A.evaluate((sid) => G.store.saveUserScenario({
      id: sid, title: "Cross-window QA scenario",
      tier: ["E4"], competency: ["Leads"], estMinutes: 2, difficulty: "Basic",
      doctrine: [{ ref: "ADP 6-22", para: "1-1", asOf: "2019-07" }],
      defaultMode: "course", renderModes: ["text", "course", "cyoa"], scene: "TEST - 0900",
      start: "n1",
      nodes: {
        n1: { prompt: "Test prompt", choices: [{ text: "Go", goto: "end1", score: { Leads: 1 }, feedback: "ok" }] },
        end1: { prompt: "", end: true, outcome: "Test outcome" },
      },
    }), id);
    const inA = await A.evaluate((sid) => G.store.userScenarios().some((s) => s.id === sid), id);
    inA ? ok("(d) A's own store.userScenarios() lists " + id) : bad("(d) A's own store.userScenarios() does not list " + id);
    const r = await until(() => B.evaluate((sid) => G.store.userScenarios().some((s) => s.id === sid), id));
    const bCount = await B.evaluate(() => G.store.userScenarios().length);
    within("(d) B's store.userScenarios() lists " + id, r, 500, "B lists " + bCount + " user scenario(s)");
    account("d", await bWrites(B, w0), []);
  }

  /* ======== (h) A changes the theme; B's root attribute ======== */
  {
    const cur = await B.evaluate(() => ({ root: document.documentElement.getAttribute("data-theme"), ids: G.theme.THEMES.map((t) => t.id), def: G.theme.DEFAULTS.theme }));
    const T = cur.ids.find((t) => t !== cur.root && t !== cur.def);
    info("(h) B root data-theme=" + JSON.stringify(cur.root) + ", default " + JSON.stringify(cur.def) + ", " + cur.ids.length + " registered themes; target T=" + JSON.stringify(T));
    T ? ok("(h) a different valid theme id exists in G.theme.THEMES") : bad("(h) no alternative theme id in " + JSON.stringify(cur.ids));
    const w0 = (await writeCounter(B)).length;
    await A.evaluate((t) => G.store.setSetting("theme", t), T);
    const r = await until(() => B.evaluate((t) => document.documentElement.getAttribute("data-theme") === t, T));
    const aRoot = await A.evaluate(() => document.documentElement.getAttribute("data-theme"));
    const bRoot = await B.evaluate(() => document.documentElement.getAttribute("data-theme"));
    within("(h) B's <html data-theme> equals " + T, r, 500, "B root now " + JSON.stringify(bRoot) + ", A root " + JSON.stringify(aRoot));
    account("h", await bWrites(B, w0), []);
  }

  /* ======== (f) 900-row burst from A while B sits on #/home ======== */
  {
    const bHash = await B.evaluate(() => location.hash);
    bHash === "#/home" ? ok("(f) B is on #/home before the burst") : bad("(f) B is on " + bHash + ", expected #/home");
    await B.evaluate(() => {
      window.__xwinHomeRenders = 0;
      const r = G.routes.find((x) => x.hash === "#/home");
      if (!r) throw new Error("no #/home route in G.routes");
      const orig = r.render;
      r.render = function (m) { window.__xwinHomeRenders++; return orig.call(this, m); };
    });
    /* Self-check of the wrap: a real navigation away and back must hit it
       exactly once, so the "0 re-renders" below is a measurement, not a
       missed hook. The counter is reset afterwards. */
    await B.evaluate(() => { location.hash = "#/progress"; });
    await settleAfter(B, 300);
    await B.evaluate(() => { location.hash = "#/home"; });
    await settleAfter(B, 400);
    const selfCheck = await B.evaluate(() => { const n = window.__xwinHomeRenders; window.__xwinHomeRenders = 0; return n; });
    selfCheck === 1 ? ok("(f) the Home render wrap fires: navigate-away-and-back self-check counted 1 render") : bad("(f) the Home render wrap counted " + selfCheck + " render(s) on a navigate-away-and-back self-check, expected 1");
    const ltBefore = (await longTasks(B)).durations.length;
    const w0 = (await writeCounter(B)).length;
    const t0 = Date.now();
    const burst = await A.evaluate(async (n) => {
      const rows = []; for (let i = 0; i < n; i++) rows.push({ k: "xwin:burst:" + i, v: { i } });
      const s = performance.now(); await G.db.putMany("kv", rows); return Math.round(performance.now() - s);
    }, BURST_ROWS);
    info("(f) A's putMany of " + BURST_ROWS + " kv rows took " + burst + " ms");
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
    const renders = await B.evaluate(() => window.__xwinHomeRenders);
    const lt = await longTasks(B);
    const ltDuring = lt.durations.slice(ltBefore);
    renders <= 2 ? ok("(f) B's Home re-rendered " + renders + " time(s) within 1000 ms of the burst (max 2)") : bad("(f) B's Home re-rendered " + renders + " times within 1000 ms of the burst (max 2)");
    info("(f) B long tasks during the burst window: " + (lt.supported ? (ltDuring.length ? ltDuring.join(", ") + " ms" : "none") : "not observable in " + ENGINE));
    account("f", await bWrites(B, w0), []);
  }

  /* ======== (e) zero errors on both pages ======== */
  {
    const nA = noise.A.filter((n) => !/favicon/.test(n));
    const nB = noise.B.filter((n) => !/favicon/.test(n));
    nA.length === 0 ? ok("(e) page A: zero page errors and zero console errors") : bad("(e) page A noise: " + nA.slice(0, 5).join(" | "));
    nB.length === 0 ? ok("(e) page B: zero page errors and zero console errors") : bad("(e) page B noise: " + nB.slice(0, 5).join(" | "));
  }

  /* ======== (i) receipt never writes ======== */
  {
    const total = receipts.reduce((n, r) => n + r.receipt.length, 0);
    const list = receipts.filter((r) => r.receipt.length).map((r) => "(" + r.caseId + ") " + r.receipt.map((e) => e.op + " " + e.store + "/" + e.key).join(", "));
    total === 0
      ? ok("(i) B made zero db write calls in response to A's actions across " + receipts.length + " windows (" + (await writeCounter(B)).length + " total B writes, all B's own)")
      : bad("(i) B made " + total + " receipt write call(s): " + list.join("; "));
  }
} catch (e) {
  bad("suite error: " + (e && e.stack || e));
} finally {
  await close();
  server.close();
}

console.log(fails ? "\nXWIN SYNC: " + fails + " FAILURE(S)" : "\nXWIN SYNC: all passed");
process.exit(fails);
