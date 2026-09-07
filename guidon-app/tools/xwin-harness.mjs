/**
 * Cross-window (two-page, one-origin) harness for the desktop roadmap's
 * cross-context sync work (T7). Not a suite itself: tools/test-xwin-sync.mjs
 * imports it. Everything measured is measured through the app's own live
 * objects (G.db, G.store, G.routes, G.theme) on two pages that share ONE
 * browser context and therefore ONE IndexedDB - the exact situation of a
 * Soldier with GUIDON open in two same-origin tabs (or, later, two Tauri
 * windows of one app); a PWA and a Tauri window are different origins.
 *
 * Exports:
 *   openPair(url, opts)  ONE browser (engine from PW_BROWSER: "webkit" or
 *                        the Chromium default; exactly one launch call in
 *                        this module, none in the suite), ONE context, TWO
 *                        pages A and B booted in sequence (never in
 *                        parallel - both would race the IndexedDB open /
 *                        upgrade) past onboarding at the same origin.
 *                        Throws if a pair is already open: this harness
 *                        refuses a second browser (VRAM hazard, see the
 *                        project's test-matrix notes). Returns
 *                        { browser, context, A, B, noise: { A: [], B: [] } }
 *                        where noise collects console errors and page
 *                        errors per page for the life of the pair.
 *     opts.hashA / opts.hashB   route each page boots on (default "#/home")
 *     opts.viewport             default 1280x880 (perf-routes.mjs's size)
 *   settleAfter(page, ms)  waits ms, then two animation frames (with a
 *                        120 ms fallback so a throttled background page
 *                        can never hang the suite).
 *   longTasks(page)      installs a PerformanceObserver for "longtask" on
 *                        first call (window.__xwinLT) and returns
 *                        { supported, durations } - the durations recorded
 *                        since install. WebKit has no longtask entry type;
 *                        supported is false there and durations stays [].
 *   dueCard(page)        the Home "board cards" card as the DOM shows it,
 *                        located the way tools/test-home-dashboard.mjs
 *                        locates it (a .card.click inside #route whose text
 *                        reads "N board cards due for review"; a never-
 *                        graded deck renders "N board cards ready to study"
 *                        instead - see views.home()'s due-count block).
 *                        Returns { due, fresh, text } - due is the number
 *                        shown when the "due for review" card is up, 0 when
 *                        the fresh "ready to study" card is up, and the
 *                        whole result is null when neither card is
 *                        rendered (Home hides the card below 3 due).
 *   writeCounter(page)   on first call wraps the LIVE G.db.put / putMany /
 *                        del / delMany / clear (installed after boot on
 *                        purpose: wrapKvCache() reassigns those same
 *                        methods during boot, so an earlier wrap would
 *                        catch nothing) to log every write call as
 *                        { t, op, store, key }. Returns the log so far.
 *                        db.setSetting() goes through this.put(), so the
 *                        store's debounced settings save is logged too.
 *   close()              closes the browser and clears the guard.
 *   ENGINE               "webkit" or "chromium", for the suite's header.
 */
import { chromium, webkit } from "playwright";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

export const ENGINE = process.env.PW_BROWSER === "webkit" ? "webkit" : "chromium";
const engine = ENGINE === "webkit" ? webkit : chromium;
const DEFAULT_VIEWPORT = { width: 1280, height: 880 };

let live = null;

async function bootPage(context, url, hash, onboardingTimeout) {
  const page = await context.newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error") noise.push("console: " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url + hash, { waitUntil: "load" });
  // Same onboarding dismissal every browser suite uses (test-home-dashboard,
  // test-progress-cache, perf-routes): a fresh profile shows the overlay and
  // "Guest Session" is chosen; a second page at the same origin usually
  // finds the choice already persisted (dismissOnboarding's own alreadyClear
  // fast path), so its look is short.
  await dismissOnboarding(page, { timeoutMs: onboardingTimeout });
  await page.waitForFunction(
    () => !!(window.G && G.db && G.store && G.routes && G.theme && typeof G.store.settings === "function"),
    null, { timeout: 15000 });
  /* The route container is populated once the boot path has rendered the
     first screen - the same element perf-routes.mjs counts nodes in. */
  await page.waitForFunction(() => { const r = document.getElementById("route"); return !!(r && r.children.length); }, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { page, noise };
}

export async function openPair(url, opts = {}) {
  if (live) throw new Error("xwin-harness: openPair() called while a browser is already open - one browser at a time; call close() first");
  /* Claim the slot BEFORE the launch awaits: two openPair() calls issued
     without awaiting the first would otherwise both pass the check above
     and launch two browsers. */
  live = { browser: null };
  let browser = null;
  try {
    browser = await engine.launch();
    live = { browser };
    const context = await browser.newContext({ viewport: opts.viewport || DEFAULT_VIEWPORT });
    const a = await bootPage(context, url, opts.hashA || "#/home", opts.onboardingTimeout || 8000);
    const b = await bootPage(context, url, opts.hashB || "#/home", 2000);
    live = { browser, context, A: a.page, B: b.page, noise: { A: a.noise, B: b.noise } };
    return live;
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    live = null;
    throw e;
  }
}

export async function settleAfter(page, ms) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 120);
  }));
}

export function longTasks(page) {
  return page.evaluate(() => {
    if (!window.__xwinLT) {
      window.__xwinLT = [];
      window.__xwinLTSupported = false;
      try {
        const types = (PerformanceObserver.supportedEntryTypes || []);
        if (types.indexOf("longtask") !== -1) {
          new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__xwinLT.push(Math.round(e.duration)); }).observe({ type: "longtask" });
          window.__xwinLTSupported = true;
        }
      } catch (e) { window.__xwinLTSupported = false; }
    }
    return { supported: window.__xwinLTSupported, durations: window.__xwinLT.slice() };
  });
}

export function dueCard(page) {
  return page.evaluate(() => {
    const route = document.getElementById("route");
    if (!route) return null;
    const cards = Array.from(route.querySelectorAll(".card.click"));
    for (const c of cards) {
      const t = (c.textContent || "").replace(/\s+/g, " ");
      let m = t.match(/(\d[\d,]*) board cards due for review/);
      if (m) return { due: Number(m[1].replace(/,/g, "")), fresh: false, text: m[0] };
      m = t.match(/(\d[\d,]*) board cards ready to study/);
      if (m) return { due: 0, fresh: true, text: m[0] };
    }
    return null;
  });
}

export function writeCounter(page) {
  return page.evaluate(() => {
    if (!window.__xwinWrites) {
      const log = window.__xwinWrites = [];
      const db = G.db;
      ["put", "putMany", "del", "delMany", "clear"].forEach((name) => {
        const orig = db[name];
        db[name] = function (store, arg) {
          let key = null;
          try {
            if (name === "put") key = arg && (arg.k !== undefined ? arg.k : arg.id);
            else if (name === "del") key = arg;
            else if (name === "putMany" || name === "delMany") key = "x" + (arg ? arg.length : 0);
          } catch (e) { key = "?"; }
          log.push({ t: Math.round(performance.now()), op: name, store, key: key === null || key === undefined ? null : String(key) });
          return orig.apply(this, arguments);
        };
      });
    }
    return window.__xwinWrites.slice();
  });
}

export async function close() {
  if (!live) return;
  const b = live.browser;
  live = null;
  if (b) await b.close();
}
