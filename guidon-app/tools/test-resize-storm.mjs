/**
 * Resize storm: drives ONE Chromium page through continuous viewport
 * changes (what a desktop user does when dragging a window edge or snapping
 * a split), instead of the fixed-viewport-at-load sweeps verify.mjs does.
 *
 * Measures, never assumes:
 *   A. width sweep 1440 -> 360 -> 1440 (4px steps): where layout modes flip,
 *      whether descending and ascending disagree (hysteresis), overflow at
 *      every step, long tasks (>50ms) during the storm.
 *   B. height sweep 880 -> 300 at desktop and phone widths: topbar/nav/main
 *      heights, whether main still scrolls, auto-theater behaviour on #/board.
 *   C. split-screen shapes.
 *   D. ultra-wide: content caps, gutters, reading measure per route.
 *   E. DPR 1.25/1.5/1.75: layout identical? any raster that would go soft?
 *   F. keyboard reachability of every nav route.
 *
 * Usage: node test-resize-storm.mjs [webDir]   (one browser, one page at a time)
 *        STORM_SKIP=B,C,E,F (comma list of phase letters A, A2, B, C, E, F;
 *        D runs inside C) skips those phases. Measured 2026-09-04: A2 and F
 *        had no gate at all and ran on every STORM_SKIP value, so a
 *        "phase A only" run also paid for F and reported F's noise.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

const WEB = process.argv[2] || "web";
const results = { pass: [], fail: [], known: [], info: {} };
// Measured defects that are pinned, not fixed: a bad() whose message matches a
// pin is printed as KNOWN and counted in results.known so the tree stays
// runnable end to end. A pin that matches nothing is itself a FAIL (the
// defect no longer reproduces - remove the pin), unless the phase that would
// have produced it was skipped via STORM_SKIP, in which case the pin is waived
// with an info line so partial runs can exit 0. Exit code ignores known.
//
// Pins carry the measured numbers ON PURPOSE: a change in the step count or
// the overhang magnitude is a real FAIL (a regression or a partial fix), not
// something to hide as KNOWN.
//
// (empty) The three Board Drill overhang pins (phase A card-column band, phase
// A .main scrollWidth, phase C 1280x480) were closed by S2 on the desktop
// roadmap, 2026-09-04: the board-drill cap-lift now starts at the same
// >=1024px tier as the two-column .drill-layout split, with a 180px list
// floor. Those rows are now ordinary PASS/FAIL like every other, and the
// phase A sweep ceiling was raised to 1440px in the same change so the
// 1284..1359px band is sampled too.
const EXPECTED_DEFECTS = [
];
const ok = (m) => { results.pass.push(m); console.log("  PASS  " + m); };
const bad = (m) => {
  const pin = EXPECTED_DEFECTS.find((p) => p.match.test(m));
  if (pin) { pin.hits = (pin.hits || 0) + 1; results.known.push(m); console.log("  KNOWN " + m); return; }
  results.fail.push(m); console.log("  FAIL  " + m);
};
const note = (m) => console.log("  info  " + m);

const { server, url } = await serve(WEB);
const browser = await chromium.launch();

const SKIP = (process.env.STORM_SKIP || "").split(",");
// Phase A width sweep bounds. The ceiling was 1280px, which left the
// 1284..1359px band (where Board Drill's cap-lift tier used to sit) unseen;
// 1440px covers the whole 1024..1360 transition plus a real desktop width.
// Phase C's fixed 1280x480 split shape is independent of these.
const SWEEP_MAX = 1440, SWEEP_MIN = 360, SWEEP_STEP = 4;
const SWEEP_LABEL = SWEEP_MIN + ".." + SWEEP_MAX;

async function boot(ctxOpts = {}, { stubFullscreen = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 880 }, ...ctxOpts });
  // Theater mode calls the real Fullscreen API; in headless Chromium that puts
  // the OS window into fullscreen state and CDP then refuses setWindowBounds.
  // Stub it so the CSS overlay (what a browser/WebView without fullscreen
  // gets) is what's exercised under resize.
  if (stubFullscreen) await ctx.addInitScript(() => {
    Element.prototype.requestFullscreen = function () { return Promise.resolve(); };
    document.exitFullscreen = function () { return Promise.resolve(); };
  });
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  // library.js's render() does a one-time same-origin HEAD probe against a
  // doc's pdfAsset - when web/docs/ genuinely isn't shipped (this repo's own
  // CI build-artifact upload deliberately excludes it, ~78MB not worth
  // re-uploading for every test-matrix job), that probe 404s and Chromium
  // logs its own unsuppressible "Failed to load resource" console line as a
  // side effect of the network layer. Phases that sweep every route (C/D)
  // or otherwise land on a doc entry can hit this - same allowance tools/
  // test-library.mjs and tools/test-csp.mjs already use: count the real
  // network-response 404 and forgive exactly that many matching console
  // lines at each phase's own assertion, so a genuinely UNEXPECTED error
  // still fails there.
  const docsProbe = { count: 0 };
  page.on("response", (r) => { if (!r.ok() && /\/docs\/.*\.pdf$/i.test(new URL(r.url()).pathname)) docsProbe.count++; });
  await page.goto(url, { waitUntil: "load" });
  // Dismiss onboarding via the shared helper: waits for the guest-session
  // card, clicks it, waits for #ob-overlay to detach - throwing loudly (with
  // on-screen diagnostics) instead of silently sailing through on a miss. A
  // fixed 700ms-then-querySelector click missed on the FIRST (cold) context
  // here (measured 2026-09-04, 3 of 3 runs: overlay still open through all of
  // phase A, then the More-drawer click timed out and crashed the run
  // uncaught). Later contexts in the same run were fine.
  await dismissOnboarding(page);
  await page.waitForTimeout(300);
  if (await page.locator("#ob-overlay").count()) bad("boot: onboarding overlay (#ob-overlay) still open after the guest-session dismissal");
  await page.evaluate(() => {
    window.__lt = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: false }); } catch (e) {}
  });
  return { ctx, page, noise, docsProbe };
}
const DOCS_PROBE_404 = /Failed to load resource: the server responded with a status of 404/;
// Filters `noise` the same way every phase already does (drop favicon 404s),
// plus forgiving up to docsProbe.count real doc-PDF-probe 404s - see boot()'s
// own comment. Call once per phase, right before that phase's own assertion.
function filterNoise(noise, docsProbe) {
  let docsAllowance = docsProbe.count;
  return noise.filter((x) => {
    if (/favicon/.test(x)) return false;
    if (docsAllowance > 0 && DOCS_PROBE_404.test(x)) { docsAllowance--; return false; }
    return true;
  });
}

// Diagnostic (2026-09-07), round 4: rounds 2 and 3 assumed #/transition's
// overflow was a stable CSS bug (a grid item, then something up its ancestor
// chain, refusing to shrink) and neither fix changed CI's numbers by a
// single pixel - because it isn't stable. Round 3's own richer diagnostic
// caught it directly: the failing snapAt() measured .view at 594px, but a
// SEPARATE measurement of the same element a few seconds later (still the
// same route, same viewport) read 551px - comfortably under .main's 587px
// limit. That's not a layout that's wrong, it's a layout caught mid-settle.
// The likeliest real mechanism is a web-font swap (FOUT): `settle` below is
// a fixed wait with no actual signal that a requested @font-face has
// resolved, and under CI's per-shard 8-concurrent-Chromium contention (see
// tools/run-parallel.mjs's own header comment) a custom font can still be
// loading when a short 150ms settle (this suite's own route-sweep value)
// elapses - text set in it briefly measures with fallback-font metrics,
// which are wider, until the real font swaps in and the width drops back
// down. document.fonts.ready is the actual condition to wait for instead of
// guessing a bigger fixed number a third time; the extra animation-frame
// wait after it resolves gives the resulting layout invalidation one paint
// to actually apply before the next measurement reads stale geometry.
const go = async (page, hash, settle = 500) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(settle);
  await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : true).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
};

// One layout-state snapshot. Cheap enough to call hundreds of times.
const SNAP = () => {
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const app = document.querySelector("#app"), nav = document.querySelector(".nav"), main = document.querySelector(".main"), view = document.querySelector(".view"), top = document.querySelector(".topbar");
  const a = cs(app), n = cs(nav), m = cs(main);
  const cols = a ? a.gridTemplateColumns.split(" ").filter(Boolean) : [];
  const railPx = cols.length > 1 ? Math.round(parseFloat(cols[0])) : 0;
  const mainR = main ? main.getBoundingClientRect() : { width: 0, height: 0 };
  const firstLink = nav ? nav.querySelector("a[data-hash],button[data-hash]") : null;
  return {
    w: innerWidth, h: innerHeight,
    rail: railPx, // 0 = bottom tab bar tier
    navDir: n ? n.flexDirection : null,
    navMore: !!document.querySelector(".nav-more-btn"),
    navLinks: document.querySelectorAll(".nav a[data-hash], .nav button[data-hash]").length,
    labelsHidden: firstLink ? parseFloat(cs(firstLink).fontSize) === 0 : null,
    mainW: Math.round(mainR.width), mainH: Math.round(mainR.height),
    viewMax: view ? cs(view).maxWidth : null,
    viewW: view ? Math.round(view.getBoundingClientRect().width) : null,
    mainPadL: m ? m.paddingLeft : null,
    topH: top ? Math.round(top.getBoundingClientRect().height) : 0,
    navH: nav ? Math.round(nav.getBoundingClientRect().height) : 0,
    docOverX: document.documentElement.scrollWidth - innerWidth,
    docOverY: document.documentElement.scrollHeight - innerHeight,
    mainOverX: main ? main.scrollWidth - main.clientWidth : 0,
    theater: document.documentElement.classList.contains("qz-theater"),
    drawer: !!document.querySelector(".nav-drawer"),
    foldClass: document.documentElement.classList.contains("device-fold-narrow"),
    boardActive: document.documentElement.classList.contains("board-drill-active"),
  };
};
// Board Drill band probe: the .drill-layout card column (the grid item that
// holds .qz-wrap) vs .main's CONTENT box. Overhang inside .main is invisible
// to document/main scrollWidth whenever .main clips or the column is still
// within .main's padding, so this is measured directly, in px.
const BAND = () => {
  const main = document.querySelector(".main"), dl = document.querySelector(".drill-layout");
  if (!main || !dl) return null;
  const kids = [...dl.children];
  const col = kids.find((c) => c.querySelector(".qz-wrap")) || kids.find((c) => c.tagName !== "BUTTON" && !c.classList.contains("list-detail-list") && !c.classList.contains("drill-readiness-pane"));
  if (!col) return null;
  const mcs = getComputedStyle(main), mr = main.getBoundingClientRect();
  const contentRight = mr.right - parseFloat(mcs.paddingRight) - parseFloat(mcs.borderRightWidth || 0);
  return { over: Math.round(col.getBoundingClientRect().right - contentRight), cols: getComputedStyle(dl).gridTemplateColumns };
};
// Elements whose right edge sits past the viewport. Descendants of a REAL
// horizontal scroll container (overflow-x auto/scroll AND scrollWidth wider
// than clientWidth) are skipped: they are scrolled, not overflowing. Measured
// 2026-09-04 (S2): the only hits over the whole 360..1440 sweep were the
// "Definitions"/"Rapid Fire" buttons of #/board's .segmented mode strip at
// 448..704px (right edge 529..711px, docOverX=0, mainOverX=0) - .segmented is
// overflow-x:auto with scroll-snap and a scroll-hint mask by design (see its
// CSS comment). That row had been hidden inside the old S2 pin's prefix match
// (78 = 66 + 12 and 116 = 104 + 12 steps). .main is overflow-x:hidden, not a
// scroller, so its clipped descendants still count - the S2 band was caught
// through BAND and .main scrollWidth, both untouched by this filter.
const WIDE = () => [...document.querySelectorAll("body *")].filter((el) => {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed")) return false;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const ox = getComputedStyle(p).overflowX;
    if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth + 1) return false;
  }
  return true;
}).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : "")).slice(0, 5);

async function snapAt(page, w, h) {
  await page.setViewportSize({ width: w, height: h });
  // one frame for layout, as a real drag would get
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(SNAP);
}
const layoutKey = (s) => "rail=" + s.rail + " navDir=" + s.navDir + " more=" + s.navMore + " labelsHidden=" + s.labelsHidden + " viewMax=" + s.viewMax + " padL=" + s.mainPadL + " theater=" + s.theater + " board=" + s.boardActive;

/* ============ A. width storm ============ */
async function widthStorm(page, route, from, to, step, h) {
  const states = new Map();
  const flips = [];
  const overflow = [];
  const band = []; // #/board only: { w, over } per step
  let prevKey = null;
  const dir = from > to ? -1 : 1;
  for (let w = from; dir < 0 ? w >= to : w <= to; w += dir * step) {
    const s = await snapAt(page, w, h);
    const k = layoutKey(s);
    states.set(w, k);
    if (prevKey !== null && k !== prevKey) flips.push({ w, from: prevKey, to: k });
    prevKey = k;
    if (s.docOverX > 1 || s.mainOverX > 1) overflow.push({ w, docOverX: s.docOverX, mainOverX: s.mainOverX });
    if (route === "#/board") { const b = await page.evaluate(BAND); if (b) band.push({ w, over: b.over }); }
    if (w % 64 === 0 || (overflow.length && overflow[overflow.length - 1].w === w)) {
      const wide = await page.evaluate(WIDE);
      if (wide.length) overflow.push({ w, wide });
    }
  }
  return { states, flips, overflow, band };
}

if (!SKIP.includes("A")) {
  const { ctx, page, noise } = await boot();
  const routes = await page.evaluate(() => window.G.routes.map((r) => r.hash || r));
  results.info.routes = routes.length;
  note("G.routes: " + routes.length);
  const STORM_ROUTES = ["#/home", "#/train", "#/doctrine", "#/settings", "#/progress", "#/board"];
  for (const r of STORM_ROUTES) {
    await go(page, r);
    await page.evaluate(() => { window.__lt.length = 0; });
    const t0 = Date.now();
    const down = await widthStorm(page, r, SWEEP_MAX, SWEEP_MIN, SWEEP_STEP, 880);
    const up = await widthStorm(page, r, SWEEP_MIN, SWEEP_MAX, SWEEP_STEP, 880);
    const ms = Date.now() - t0;
    const lt = await page.evaluate(() => window.__lt.slice());
    const flipW = down.flips.map((f) => f.w);
    note(r + ": " + flipW.length + " flips descending at widths [" + flipW.join(", ") + "]; " + up.flips.length + " ascending at [" + up.flips.map((f) => f.w).join(", ") + "]; " + ms + "ms for " + (down.states.size * 2) + " steps; long tasks: " + lt.length + (lt.length ? " (" + lt.slice(0, 8).join(",") + "ms)" : ""));
    for (const f of down.flips) note("    @" + f.w + " down: " + f.from + "  ->  " + f.to);
    const hys = [...down.states.keys()].filter((w) => up.states.get(w) !== down.states.get(w));
    hys.length === 0 ? ok(r + ": no hysteresis - descending and ascending sweeps agree at all " + down.states.size + " widths")
      : bad(r + ": HYSTERESIS at " + hys.length + " widths, e.g. " + hys.slice(0, 5).join(",") + ': down="' + down.states.get(hys[0]) + '" up="' + up.states.get(hys[0]) + '"');
    const ov = [...down.overflow, ...up.overflow];
    ov.length === 0 ? ok(r + ": no horizontal overflow at any step " + SWEEP_LABEL)
      : bad(r + ": overflow at " + ov.length + " steps: " + JSON.stringify(ov.slice(0, 4)));
    if (r === "#/board") {
      const band = [...down.band, ...up.band];
      const hit = band.filter((b) => b.over > 1);
      const worst = hit.reduce((a, b) => (b.over > a.over ? b : a), { over: -Infinity, w: 0 });
      const ws = hit.map((b) => b.w);
      if (hit.length) note("#/board: overhang band " + Math.min(...ws) + ".." + Math.max(...ws) + "px wide (" + hit.length + " of " + band.length + " steps), sample: " + hit.filter((b) => b.w % 64 === 0 || b.w === worst.w).slice(0, 8).map((b) => b.w + ":" + b.over + "px").join(" "));
      hit.length === 0 ? ok("#/board: card column stays inside .main content box at all " + band.length + " steps " + SWEEP_LABEL)
        : bad("#/board: card column overhangs .main content box at " + hit.length + " of " + band.length + " steps (max " + worst.over + "px at " + worst.w + "px)");
    }
    lt.filter((d) => d >= 100).length === 0 ? ok(r + ": no long task >=100ms during " + (down.states.size * 2) + " resize steps (" + lt.length + " >=50ms)")
      : bad(r + ": " + lt.filter((d) => d >= 100).length + " long tasks >=100ms during resize storm: " + lt.filter((d) => d >= 100).join(",") + "ms");
  }
  // modal-open resize: More drawer at 500px then widen across 600
  await go(page, "#/home");
  await snapAt(page, 500, 880);
  await page.waitForTimeout(200);
  await page.click(".nav-more-btn");
  await page.waitForTimeout(300);
  let s = await page.evaluate(SNAP);
  s.drawer ? note("More drawer opened at 500px") : bad("More drawer did not open at 500px");
  s = await snapAt(page, 700, 880);
  // The app closes the drawer from the async matchMedia("(min-width: 600px)")
  // change listener; a fixed 200ms settle flaked 2 in 5 runs. Wait for the
  // drawer to actually go (cap 2s); on timeout SNAP still reads drawer=true.
  await page.waitForFunction(() => !document.querySelector(".nav-drawer"), null, { timeout: 2000 }).catch(() => {});
  s = await page.evaluate(SNAP);
  (!s.drawer && s.rail === 96) ? ok("drawer open at 500px -> resize to 700px: drawer closed, compact rail rendered (no stranded modal)") : bad("drawer/rail after crossing 600px: drawer=" + s.drawer + " rail=" + s.rail);
  const nA = noise.filter((x) => !/favicon/.test(x));
  nA.length === 0 ? ok("A: no console errors/warnings during width storm") : bad("A: console noise: " + nA.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ============ A2. theater under resize (Fullscreen API stubbed) ============ */
if (!SKIP.includes("A2")) {
  const { ctx, page, noise } = await boot({}, { stubFullscreen: true });
  let s;
  await go(page, "#/board");
  await page.evaluate(() => { const row = document.querySelector(".list-detail-row"); if (row) row.click(); });
  await page.waitForTimeout(800);
  await snapAt(page, 1280, 880);
  await page.evaluate(() => { const b = document.querySelector(".qz-fs-btn"); if (b) b.click(); });
  await page.waitForTimeout(400);
  s = await page.evaluate(SNAP);
  s.theater ? note("theater entered via .qz-fs-btn at 1280x880") : bad("could not enter theater via .qz-fs-btn");
  const th = [];
  for (const [w, h] of [[900, 600], [640, 480], [1152, 350], [2000, 1000], [1280, 880]]) {
    const t = await snapAt(page, w, h);
    const card = await page.evaluate(() => { const c = document.querySelector(".qz-card"); const r = c ? c.getBoundingClientRect() : null; return r ? { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) } : null; });
    th.push({ w, h, theater: t.theater, card, overY: t.docOverY });
  }
  note("theater under resize: " + JSON.stringify(th));
  th.every((t) => t.theater) ? ok("theater survives resizes 900x600 / 640x480 / 1152x350 / 2000x1000 without exiting") : bad("theater exited during resize: " + JSON.stringify(th));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterEsc = await page.evaluate(SNAP);
  !afterEsc.theater ? ok("Escape exits theater after the resize sequence") : bad("Escape did not exit theater after resizing");
  const n = noise.filter((x) => !/favicon/.test(x));
  n.length === 0 ? ok("A2: no console errors/warnings during theater resize") : bad("A2: console noise: " + n.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ============ B. height storm ============ */
if (!SKIP.includes("B")) {
  const { ctx, page, noise } = await boot({}, { stubFullscreen: true });
  for (const [w, route] of [[1280, "#/home"], [1152, "#/doctrine"], [500, "#/home"], [1152, "#/board"]]) {
    // Reset to a tall viewport BEFORE mounting the route: Board Drill's
    // mount-time auto-theater check reads the viewport it mounts into.
    await snapAt(page, w, 880);
    await go(page, route);
    if (route === "#/board") { await page.evaluate(() => { const row = document.querySelector(".list-detail-row"); if (row) row.click(); }); await page.waitForTimeout(800); }
    const rows = [];
    for (let h = 880; h >= 300; h -= 20) {
      const s = await snapAt(page, w, h);
      const extra = await page.evaluate(() => {
        const main = document.querySelector(".main");
        const fixed = [...document.querySelectorAll("body *")].filter((el) => { const p = getComputedStyle(el).position; return (p === "fixed" || p === "sticky") && el.getBoundingClientRect().height > 0 && el.id !== "toast"; }).map((el) => el.tagName.toLowerCase() + "#" + el.id + "." + String(el.className).split(" ")[0]);
        return { mainScrollable: main ? main.scrollHeight > main.clientHeight : null, mainClientH: main ? main.clientHeight : 0, fixed: fixed.slice(0, 6) };
      });
      rows.push({ h, topH: s.topH, navH: s.navH, mainH: s.mainH, mainClientH: extra.mainClientH, scrollable: extra.mainScrollable, theater: s.theater, docOverY: s.docOverY, fixed: extra.fixed });
    }
    const pick = rows.filter((r) => [880, 600, 480, 460, 440, 400, 350, 300].includes(r.h));
    note(w + "px wide " + route + ": " + pick.map((r) => "h" + r.h + ": top=" + r.topH + " nav=" + r.navH + " main=" + r.mainClientH + (r.theater ? " THEATER" : "") + (r.docOverY > 0 ? " docOverY=" + r.docOverY : "")).join(" | "));
    const fixedSet = new Set(rows.flatMap((r) => r.fixed));
    if (fixedSet.size) note(w + "px wide " + route + ": fixed/sticky elements seen: " + [...fixedSet].join(", "));
    const at480 = rows.find((r) => r.h === 480);
    const tooSmall = rows.filter((r) => r.h >= 480 && r.mainClientH < 200 && !r.theater);
    tooSmall.length === 0 ? ok(w + "px wide " + route + ": content area keeps >=200px down to the 480px minHeight (at h=480 main=" + (at480 ? at480.mainClientH : "?") + "px)") : bad(w + "px wide " + route + ": content area under 200px at heights " + tooSmall.map((r) => r.h).join(","));
    const docScroll = rows.filter((r) => r.docOverY > 0 && !r.theater);
    docScroll.length === 0 ? ok(w + "px wide " + route + ": document itself never scrolls (app stays a fixed-height grid) at any height 880..300") : bad(w + "px wide " + route + ": document scrolls at heights " + docScroll.map((r) => r.h + ":" + r.docOverY).join(","));
    if (route === "#/board") {
      const first = rows.find((r) => r.theater);
      first ? note("#/board active card: AUTO-THEATER engaged when height reached " + first.h + "px (landscape, <460 rule) and stayed on for the rest of the sweep") : note("#/board: auto-theater never engaged");
      const at480 = rows.find((r) => r.h === 480);
      (at480 && !at480.theater) ? ok("#/board: at the Tauri minHeight (480px) auto-theater does NOT fire - the <460px rule is unreachable in the desktop shell") : bad("#/board: auto-theater fired at >=480px tall - reachable inside the desktop minHeight");
      await snapAt(page, 1152, 880); await page.waitForTimeout(400);
      const after = await page.evaluate(SNAP);
      note("#/board: after growing back to 1152x880, theater=" + after.theater + " (auto-exit " + (after.theater ? "does NOT happen - user must press Escape/F" : "happened") + ")");
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    }
  }
  const n = noise.filter((x) => !/favicon/.test(x));
  n.length === 0 ? ok("B: no console errors/warnings during height storm") : bad("B: console noise: " + n.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ============ C. split-screen shapes + D. ultra-wide ============ */
if (!SKIP.includes("C")) {
  const { ctx, page, noise, docsProbe } = await boot();
  const routes = await page.evaluate(() => window.G.routes.map((r) => r.hash || r));
  const SHAPES = [[1152, 350], [960, 400], [683, 768], [640, 720], [1280, 480], [2560, 1440], [3440, 1440], [1920, 1080]];
  for (const [w, h] of SHAPES) {
    const overflowRoutes = [];
    const widest = { view: 0, main: 0 };
    const measure = [];
    for (const r of routes) {
      await go(page, r, 150);
      const s = await snapAt(page, w, h);
      if (s.docOverX > 1 || s.mainOverX > 1) {
        // Diagnostic (2026-09-07), round 2: this exact check failed
        // identically in CI (#/transition at 683x768, main=25px) but passed
        // clean in a full local run every time - never reproduced locally.
        // Round 1 tried WIDE() (viewport-relative: flags an element whose
        // own getBoundingClientRect().right exceeds innerWidth) and it came
        // back empty on the next CI failure - a real, useful negative
        // result: .main has overflow-x:hidden (see its own CSS comment on
        // the BFC this establishes), which CLIPS visual overflow rather
        // than letting it bleed past the viewport, so nothing there ever
        // trips WIDE()'s own check even though .main's scrollWidth still
        // reports the true, clipped-away content width - exactly what
        // mainOverX already measures. This is the corrected diagnostic:
        // walk .main's own descendants directly (not viewport-relative)
        // for the first one whose own content is wider than .main's real
        // clientWidth, which a clipping ancestor can't hide from this check
        // the way it hides from WIDE()'s.
        const mainWide = await page.evaluate(() => {
          const main = document.querySelector(".main");
          if (!main) return [];
          const limit = main.clientWidth;
          const out = [];
          main.querySelectorAll("*").forEach((el) => {
            const w = Math.max(el.scrollWidth, el.getBoundingClientRect().width);
            if (w > limit + 1) out.push({ tag: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : ""), w: Math.round(w) });
          });
          // Widest first, but only the shallowest/first few - a genuine
          // culprit's own ancestors up to .main will also all read "too
          // wide" (they contain it), so the interesting signal is the
          // narrowest reported width among the widest handful: the element
          // actually causing the overflow, not everything it's nested in.
          out.sort((a, b) => a.w - b.w);
          return out.slice(0, 4);
        });
        // Diagnostic (2026-09-07), round 5: rounds 3-4 both misdiagnosed this
        // because the round-3 chain-walker had a real bug - it found the
        // narrowest OFFENDER (div.view, flagged because Math.max(scrollWidth,
        // rectWidth) = 594 exceeds .main's limit) and then walked UPWARD
        // toward .main looking for an ancestor refusing to shrink. But
        // div.view's own rendered width was a separate 551px (fits fine) -
        // its SCROLLWIDTH is what's 594, meaning the overflow is INSIDE
        // div.view's own subtree, not above it. .closest(".card-results-
        // grid") on div.view then correctly returned null every time (the
        // grid is a descendant of .view, not an ancestor - .closest() only
        // ever looks upward), which is why gridDebug was always empty and
        // why round 4's font-swap theory, built on that same "it must be
        // above/around .view" framing, also didn't move CI's numbers: the
        // real content was never inspected at all, four rounds running.
        // This descends INSTEAD of ascending: re-runs the identical
        // find-the-narrowest-overflowing-element algorithm, but re-rooted
        // one level down, INSIDE div.view's own subtree, with view's own
        // clientWidth as the new limit - the correct next step into the
        // same DOM region this test has been trying to see for two rounds.
        const chainDebug = await page.evaluate(() => {
          const main = document.querySelector(".main");
          if (!main) return null;
          const limit = main.clientWidth;
          let outer = null, outerW = Infinity;
          main.querySelectorAll("*").forEach((el) => {
            const w = Math.max(el.scrollWidth, el.getBoundingClientRect().width);
            if (w > limit + 1 && w < outerW) { outerW = w; outer = el; }
          });
          if (!outer) return null;
          const describe = (el) => ({
            tag: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : ""),
            ownW: Math.round(el.getBoundingClientRect().width), scrollW: el.scrollWidth, clientW: el.clientWidth,
            display: getComputedStyle(el).display, minWidth: getComputedStyle(el).minWidth,
          });
          // Descend from `outer` (its own rendered box may fit fine - the
          // problem is its DESCENDANTS' scrollWidth pushing it) to find the
          // deepest, narrowest element that still itself exceeds ITS OWN
          // parent's clientWidth - the actual leaf responsible, not just
          // "somewhere in here."
          let node = outer, trail = [describe(outer)], guard = 0;
          for (;;) {
            if (++guard > 20) break;
            const innerLimit = node.clientWidth;
            let next = null, nextW = Infinity;
            Array.from(node.querySelectorAll("*")).forEach((el) => {
              if (el.children.length === 0 && !el.textContent.trim()) return; // skip empty leaves
              const w = Math.max(el.scrollWidth, el.getBoundingClientRect().width);
              if (w > innerLimit + 1 && w < nextW) { nextW = w; next = el; }
            });
            if (!next || next === node) break;
            trail.push(describe(next));
            node = next;
          }
          const grid = outer.querySelector(".card-results-grid") || node.closest(".card-results-grid");
          let gridDebug = null;
          if (grid) {
            const gcs = getComputedStyle(grid);
            gridDebug = {
              gridTemplateColumns: gcs.gridTemplateColumns,
              gridW: Math.round(grid.getBoundingClientRect().width), gridScrollW: grid.scrollWidth,
              kids: Array.from(grid.children).map((k) => ({
                tag: k.tagName.toLowerCase() + (k.className && typeof k.className === "string" ? "." + k.className.split(" ")[0] : ""),
                w: Math.round(k.getBoundingClientRect().width), scrollW: k.scrollWidth,
              })),
            };
          }
          return { mainLimit: limit, leafText: (node.textContent || "").trim().slice(0, 80), trail, gridDebug };
        });
        overflowRoutes.push(r + "(doc=" + s.docOverX + ",main=" + s.mainOverX + (mainWide.length ? ",mainWide=" + mainWide.map((x) => x.tag + ":" + x.w).join("|") : ",mainWide=none-found") + ")");
        if (chainDebug) console.log("  DEBUG " + r + " @" + w + "x" + h + ": " + JSON.stringify(chainDebug));
      }
      widest.view = Math.max(widest.view, s.viewW || 0); widest.main = Math.max(widest.main, s.mainW || 0);
      if (w >= 1920) {
        const m = await page.evaluate(() => {
          let worst = null;
          const els = document.querySelectorAll(".main p, .main li, .main dd, .main .hint, .main td, .main .card-body, .main .doc-body, .main .panel > div");
          for (const el of els) {
            if ((el.textContent || "").trim().length < 160) continue;
            const r = el.getBoundingClientRect(); if (r.width < 1) continue;
            const probe = document.createElement("span"); probe.textContent = "0".repeat(100); probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
            el.appendChild(probe); const ch = r.width / (probe.getBoundingClientRect().width / 100); probe.remove();
            if (!worst || ch > worst.ch) worst = { ch: Math.round(ch), px: Math.round(r.width), tag: el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0] };
          }
          return worst;
        });
        if (m) measure.push({ r, ...m });
      }
    }
    overflowRoutes.length === 0 ? ok(w + "x" + h + ": no horizontal overflow across " + routes.length + " routes (widest .view " + widest.view + "px, .main " + widest.main + "px)") : bad(w + "x" + h + ": overflow on " + overflowRoutes.length + " routes: " + overflowRoutes.slice(0, 6).join(", "));
    if (measure.length) {
      const over = measure.filter((m) => m.ch > 90).sort((a, b) => b.ch - a.ch);
      note(w + "x" + h + ": routes whose widest long-text block exceeds 90ch: " + over.length + "/" + measure.length + " -> " + over.slice(0, 14).map((m) => m.r + " " + m.ch + "ch(" + m.tag + ")").join(", "));
    }
  }
  const n = filterNoise(noise, docsProbe);
  n.length === 0 ? ok("C/D: no console errors/warnings") : bad("C/D: console noise: " + n.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ============ E. DPR ============ */
if (!SKIP.includes("E")) {
  const base = {};
  for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
    const { ctx, page } = await boot({ deviceScaleFactor: dpr, viewport: { width: 1280, height: 880 } });
    await go(page, "#/home");
    const s = await page.evaluate(SNAP);
    const raster = await page.evaluate(() => {
      const imgs = document.querySelectorAll("img").length, canv = document.querySelectorAll("canvas").length;
      let bg = 0; for (const el of document.querySelectorAll("body *")) { const b = getComputedStyle(el).backgroundImage; if (b && /url\(/.test(b) && !/svg/.test(b)) bg++; }
      return { imgs, canv, bgRaster: bg, dpr: devicePixelRatio };
    });
    base[dpr] = { rail: s.rail, viewW: s.viewW, mainW: s.mainW, topH: s.topH, ...raster };
    await ctx.close();
  }
  note("DPR sweep @1280x880 #/home: " + JSON.stringify(base));
  const keys = Object.values(base).map((b) => b.rail + "/" + b.viewW + "/" + b.mainW + "/" + b.topH);
  new Set(keys).size === 1 ? ok("E: layout geometry identical at DPR 1/1.25/1.5/1.75/2 (CSS px are logical; scaling is not a layout variable)") : bad("E: layout differs by DPR: " + keys.join(" vs "));
  (base[1].imgs === 0 && base[1].canv === 0 && base[1].bgRaster === 0) ? ok("E: #/home has zero <img>, <canvas>, or raster background-image - nothing to go soft at 150%/175%") : note("E: raster candidates on #/home: " + JSON.stringify(base[1]));
}

/* ============ F. keyboard reachability ============ */
if (!SKIP.includes("F")) {
  const { ctx, page, noise, docsProbe } = await boot({ viewport: { width: 1440, height: 900 } });
  const routes = await page.evaluate(() => window.G.routes.map((r) => r.hash || r));
  await page.evaluate(() => { document.querySelectorAll(".nav .nav-group-header[aria-expanded='false']").forEach((h) => h.click()); });
  await page.waitForTimeout(600); // let the max-height transition finish before reading it
  const navInfo = await page.evaluate(() => {
    const links = [...document.querySelectorAll(".nav a[data-hash], .nav button[data-hash]")];
    return { hashes: links.map((l) => l.dataset.hash), tabbable: links.filter((l) => l.tabIndex >= 0).length, groups: document.querySelectorAll(".nav .nav-group-header").length, bodyMax: [...document.querySelectorAll(".nav .nav-group-body")].map((b) => ({ max: getComputedStyle(b).maxHeight, sh: b.scrollHeight })) };
  });
  const notInNav = routes.filter((r) => !navInfo.hashes.includes(r));
  note("nav exposes " + navInfo.hashes.length + " of " + routes.length + " routes in " + navInfo.groups + " groups; roving tabindex leaves " + navInfo.tabbable + " tab stop(s). Not in nav: " + (notInNav.join(", ") || "none"));
  const clipped = navInfo.bodyMax.filter((b) => b.sh > parseFloat(b.max));
  clipped.length === 0 ? ok("F: no open nav group body exceeds its max-height cap (" + navInfo.bodyMax.map((b) => b.sh + "/" + b.max).join(", ") + ")") : bad("F: nav group body clipped by max-height cap: " + JSON.stringify(clipped));
  await go(page, "#/home");
  const reached = await page.evaluate(async () => {
    const links = [...document.querySelectorAll(".nav a[data-hash]")];
    const out = new Set();
    for (const l of links) {
      l.focus();
      const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      l.dispatchEvent(ev);
      if (!ev.defaultPrevented) l.click();
      await new Promise((r) => setTimeout(r, 60));
      out.add(location.hash);
    }
    return [...out];
  });
  const missing = navInfo.hashes.filter((h) => !reached.includes(h));
  missing.length === 0 ? ok("F: every nav route (" + navInfo.hashes.length + ") activates from keyboard focus + Enter") : bad("F: " + missing.length + " nav routes not reached by keyboard: " + missing.join(", "));
  await go(page, "#/home");
  await page.evaluate(() => document.querySelector(".nav a[data-hash]").focus());
  const before = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
  const after = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
  before !== after ? ok('F: ArrowDown moves focus inside the sidebar ("' + before + '" -> "' + after + '")') : bad('F: ArrowDown did not move focus in the sidebar (stuck on "' + before + '")');
  const probes = [];
  for (const key of ["?", "/", "Control+k", "Alt+1", "F1", "g h"]) {
    await go(page, "#/home", 200);
    await page.evaluate(() => document.body.focus());
    const h0 = await page.evaluate(() => location.hash);
    const d0 = await page.evaluate(() => document.querySelectorAll("[role=dialog],.gm-back").length);
    if (key === "g h") { await page.keyboard.press("g"); await page.keyboard.press("h"); } else await page.keyboard.press(key);
    await page.waitForTimeout(200);
    const h1 = await page.evaluate(() => location.hash);
    const d1 = await page.evaluate(() => document.querySelectorAll("[role=dialog],.gm-back").length);
    const focused = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className || document.activeElement.tagName));
    probes.push(key + ": " + ((h0 === h1 && d0 === d1) ? "no effect" : "EFFECT hash=" + h1 + " dialogs=" + d1) + " focus=" + focused);
  }
  note("F: global shortcut probes: " + probes.join(" ; "));
  await snapAt(page, 500, 880);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector(".nav-more-btn").focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const drawerOpen = await page.evaluate(() => !!document.querySelector(".nav-drawer"));
  drawerOpen ? ok("F: at 500px the More drawer opens from keyboard (Enter on the focused button)") : bad("F: More drawer did not open from keyboard at 500px");
  await page.keyboard.press("Escape");
  const n = filterNoise(noise, docsProbe);
  n.length === 0 ? ok("F: no console errors/warnings") : bad("F: console noise: " + n.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close();
server.close();
for (const pin of EXPECTED_DEFECTS) {
  if (pin.hits) continue;
  // A pin whose phase never ran cannot have reproduced; waive it rather than
  // failing a deliberately partial run (STORM_SKIP=A etc.).
  if (SKIP.includes(pin.phase)) { note("pin waived, phase " + pin.phase + " skipped: " + pin.why); continue; }
  bad("expected defect did not reproduce - remove its pin: " + pin.why);
}
console.log("\n" + "=".repeat(64));
console.log("RESIZE STORM: " + results.pass.length + " pass, " + results.fail.length + " fail, " + results.known.length + " known");
if (results.known.length) results.known.forEach((k) => console.log("  known: " + k));
if (results.fail.length) results.fail.forEach((f) => console.log("  - " + f));
console.log("=".repeat(64));
process.exit(results.fail.length ? 1 : 0);
