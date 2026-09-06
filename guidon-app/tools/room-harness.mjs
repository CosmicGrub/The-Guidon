/**
 * Study-room harness (collective P3a): N GUIDON pages in ONE browser and ONE
 * context, wired through a fake in-process transport at the room module's
 * seam (G.studyGroup.attach({ send, onmessage, open, close })). Not a suite:
 * tools/test-room-session.mjs and tools/test-room-privacy.mjs import it.
 *
 * The seam is what gets mocked - never the WebSocket class. Every page gets
 * a transport object whose send(frame, to) is proxied (page.exposeFunction)
 * into this process, where a hub queues the frame and delivers it to the
 * destination page by calling the handler that page registered through
 * onmessage(). Frames cross the boundary as JSON text both ways, the way
 * they will over a socket. Whoever hosts is the hub's host page; peers'
 * frames always go to the host, the host addresses peers by fingerprint
 * (learned from the `from` of the first frame each page sends) or "*".
 *
 * Exports:
 *   openRoom(url, n, opts)  ONE browser (Chromium; exactly one launch call
 *                           in this module, none in the suites - tools/
 *                           lint-ci-matrix.mjs counts them), ONE context,
 *                           n pages booted IN SEQUENCE past onboarding as
 *                           Guest at the same origin, all with the study-
 *                           groups kill switch ON (G.store.setSetting on
 *                           the first page before the others boot, then on
 *                           every page). Throws if a room is already open:
 *                           this harness refuses a second browser (VRAM
 *                           hazard). Returns { browser, context, pages,
 *                           noise } where noise[i] collects console errors
 *                           and page errors for page i.
 *     opts.hash             route every page boots on (default "#/group")
 *     opts.viewport         default 1280x880
 *     opts.studyGroups      default true; false leaves the switch OFF
 *   fakeTransport(opts)     the hub: { wire(page, {host}), setHost(page),
 *                           kill(page), revive(page), log, stats, drain(),
 *                           fpOf(page), pageOf(fp) }.
 *     opts.delay            ms added to every delivery (default 0)
 *     opts.drop             probability a frame is dropped (default 0;
 *                           seeded PRNG, see opts.seed)
 *     opts.reorder          true: deliveries get a random 0-20 ms jitter
 *                           (queued, so order is preserved)
 *     opts.jitterMs         > 0: every delivery gets its OWN timer of
 *                           0..jitterMs ms, so frames really reorder at
 *                           the seam; hub.setJitter(ms) changes it live
 *     hub.dropPongs(page, on)  drop that page's outbound PONGS only (its
 *                           pings still arrive): the dead-peer proof
 *     rec.arrival           the receiving page's own receive counter,
 *                           taken in-page in the turn that ran the
 *                           handler: THE arrival-order oracle (on a
 *                           broadcast it is the last target's number)
 *     rec.deliveredAt       Node-side Date.now() after the evaluate came
 *                           back (informational; ties and can invert)
 *     opts.log              array to push every routed frame into
 *                           ({ t, from, to, page, frame, dropped })
 *   writeSpy(page)          wraps the LIVE G.db.put / putMany / del /
 *                           delMany / clear on first call (after boot, on
 *                           purpose - wrapKvCache() reassigns them during
 *                           boot) and returns the log so far:
 *                           [{ t, op, store, key }]. putMany/delMany log
 *                           one entry per row so a key can be matched.
 *   close()                 closes the browser and clears the guard.
 */
import { chromium } from "playwright";
import { dismissOnboarding as sharedDismissOnboarding } from "./dismiss-onboarding.mjs";

const DEFAULT_VIEWPORT = { width: 1280, height: 880 };
let live = null;

/* Delegates to the shared tools/dismiss-onboarding.mjs helper; kept as a
   local wrapper so bootPage()'s existing numeric-timeout call sites (here
   and in every suite that imports bootPage) do not need to change shape. */
async function dismissOnboarding(page, timeout) {
  return sharedDismissOnboarding(page, { timeoutMs: timeout });
}

export async function bootPage(context, url, hash, onboardingTimeout) {
  const page = await context.newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error") noise.push("console: " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url + hash, { waitUntil: "load" });
  await page.waitForTimeout(500);
  await dismissOnboarding(page, onboardingTimeout);
  await page.waitForFunction(
    () => !!(window.G && G.db && G.store && G.routes && typeof G.store.settings === "function"),
    null, { timeout: 15000 });
  await page.waitForFunction(() => { const r = document.getElementById("route"); return !!(r && r.children.length); }, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  return { page, noise };
}

export async function openRoom(url, n, opts = {}) {
  if (live) throw new Error("room-harness: openRoom() called while a browser is already open - one browser at a time; call close() first");
  live = { browser: null };
  let browser = null;
  const want = opts.studyGroups !== false;
  try {
    browser = await chromium.launch();
    live = { browser };
    const context = await browser.newContext({ viewport: opts.viewport || DEFAULT_VIEWPORT });
    const pages = [], noise = [];
    for (let i = 0; i < n; i++) {
      const b = await bootPage(context, url, opts.hash || "#/group", i === 0 ? 8000 : 2500);
      pages.push(b.page); noise.push(b.noise);
      await b.page.evaluate(async (v) => { await G.store.setSetting("studyGroups", v); }, want);
      /* The first page's debounced settings save (300 ms) must land before
         the next page boots and reads the shared settings row. */
      if (i === 0) await b.page.waitForTimeout(600);
    }
    for (const p of pages) await p.evaluate(async (v) => { await G.store.setSetting("studyGroups", v); }, want);
    await pages[0].waitForTimeout(500);
    live = { browser, context, pages, noise };
    return live;
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    live = null;
    throw e;
  }
}

/* Small seeded PRNG so a drop/reorder run is reproducible. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fakeTransport(opts = {}) {
  const delay = opts.delay || 0;
  const drop = opts.drop || 0;
  const reorder = !!opts.reorder;
  const log = opts.log || [];
  const rnd = mulberry32(opts.seed || 7);
  const entries = new Map(); // page -> { page, idx, host, alive, fp, dropPongs }
  const byFp = new Map();     // fp -> entry
  const stats = { sent: 0, delivered: 0, dropped: 0, undeliverable: 0 };
  let host = null;
  let queue = Promise.resolve();
  let jitterMs = opts.jitterMs || 0;
  const inFlight = new Set();
  const seq = { n: 0 };

  function nameOf(e) { return e ? (e.host ? "host" : "p" + e.idx) : "?"; }

  async function deliverTo(entry, json, rec) {
    if (!entry || !entry.alive) { stats.undeliverable++; rec.dropped = "dead"; return; }
    try {
      /* The arrival number is taken INSIDE the page, in the same synchronous
         turn that hands the frame to the handler, so it is the receiving
         page's own receive order. A Node-side Date.now() after the evaluate
         resolves is not: two evaluates can resolve out of the order their
         handlers ran (the round trip back to Node has its own jitter), and
         a millisecond stamp ties. rec.arrival is monotonic per page. */
      const got = await entry.page.evaluate((s) => {
        const h = window.__roomHandler;
        if (typeof h !== "function") return 0;
        const n = window.__roomArrival = (window.__roomArrival || 0) + 1;
        h(JSON.parse(s));
        return n;
      }, json);
      if (got) { stats.delivered++; rec.deliveredAt = Date.now(); rec.arrival = got; } else { stats.undeliverable++; rec.dropped = "no-handler"; }
    } catch (e) { stats.undeliverable++; rec.dropped = "closed"; }
  }

  function route(fromEntry, json, to) {
    stats.sent++;
    let frame = null;
    try { frame = JSON.parse(json); } catch (e) { frame = { unparseable: json }; }
    if (frame && typeof frame.from === "string" && frame.from) {
      if (!byFp.has(frame.from)) byFp.set(frame.from, fromEntry);
      fromEntry.fp = frame.from;
    }
    const rec = { t: Date.now(), n: ++seq.n, from: nameOf(fromEntry), to: to == null ? "" : String(to), frame, dropped: null };
    log.push(rec);
    if (!fromEntry.alive) { rec.dropped = "sender-dead"; stats.dropped++; return; }
    if (fromEntry.dropPongs && frame && frame.t === "pong") { rec.dropped = "pong-dropped"; stats.dropped++; return; }
    if (drop && rnd() < drop) { rec.dropped = "drop"; stats.dropped++; return; }
    const targets = [];
    if (fromEntry.host) {
      if (to === "*" || to == null) { for (const e of entries.values()) if (!e.host) targets.push(e); }
      else { const e = byFp.get(String(to)); if (e) targets.push(e); else { rec.dropped = "unknown-fp"; stats.undeliverable++; return; } }
    } else {
      if (host) targets.push(host); else { rec.dropped = "no-host"; stats.undeliverable++; return; }
    }
    const wait = delay + (reorder ? Math.floor(rnd() * 20) : 0);
    const run = () => Promise.all(targets.map((e) => deliverTo(e, json, rec)));
    if (jitterMs > 0) {
      /* Independent timers: two frames sent 1 ms apart can arrive in
         either order, which is what a real radio does. */
      const p = new Promise((r) => setTimeout(r, wait + Math.floor(rnd() * jitterMs))).then(run);
      inFlight.add(p);
      p.finally(() => inFlight.delete(p));
      return p;
    }
    if (wait) {
      queue = queue.then(() => new Promise((r) => setTimeout(r, wait))).then(run);
    } else {
      queue = queue.then(run);
    }
    return queue;
  }

  const hub = {
    log, stats,
    async wire(page, o = {}) {
      const entry = { page, idx: entries.size, host: !!o.host, alive: true, fp: null, dropPongs: false };
      entries.set(page, entry);
      if (entry.host) host = entry;
      await page.exposeFunction("__roomSend", (json, to) => { route(entry, String(json), to); return true; });
      await page.evaluate(() => {
        window.__roomTransport = {
          kind: "fake", peer: "room-harness (in-process)",
          send(frame, to) { return window.__roomSend(JSON.stringify(frame), to == null ? null : String(to)); },
          onmessage(h) { window.__roomHandler = h; },
          onclose(h) { window.__roomOnClose = h; },
          open() { window.__roomOpen = true; },
          close() { window.__roomOpen = false; window.__roomHandler = null; },
        };
      });
      return entry;
    },
    setHost(page) { for (const e of entries.values()) e.host = (e.page === page); host = entries.get(page) || null; },
    /* Sever a page's link both ways (a phone walking out of Wi-Fi range):
       its frames are dropped and nothing reaches it. The page itself keeps
       running. revive() restores the link. */
    kill(page) { const e = entries.get(page); if (e) e.alive = false; },
    revive(page) { const e = entries.get(page); if (e) e.alive = true; },
    dropPongs(page, on) { const e = entries.get(page); if (e) e.dropPongs = on !== false; },
    setJitter(ms) { jitterMs = Math.max(0, Number(ms) || 0); },
    fpOf(page) { const e = entries.get(page); return e ? e.fp : null; },
    pageOf(fp) { const e = byFp.get(fp); return e ? e.page : null; },
    drain() { return Promise.all([queue, ...inFlight]).then(() => (inFlight.size ? Promise.all([...inFlight]) : null)); },
  };
  return hub;
}

export function writeSpy(page) {
  return page.evaluate(() => {
    if (!window.__roomWrites) {
      const log = window.__roomWrites = [];
      const db = G.db;
      ["put", "putMany", "del", "delMany", "clear"].forEach((name) => {
        const orig = db[name];
        db[name] = function (store, arg) {
          try {
            if (name === "put") log.push({ t: Math.round(performance.now()), op: name, store, key: arg == null ? null : String(arg.k !== undefined ? arg.k : arg.id) });
            else if (name === "del") log.push({ t: Math.round(performance.now()), op: name, store, key: String(arg) });
            else if (name === "putMany" || name === "delMany") {
              const rows = Array.isArray(arg) ? arg : [];
              if (!rows.length) log.push({ t: Math.round(performance.now()), op: name, store, key: "x0" });
              rows.forEach((r) => log.push({ t: Math.round(performance.now()), op: name, store, key: r == null ? null : (typeof r === "object" ? String(r.k !== undefined ? r.k : r.id) : String(r)) }));
            } else log.push({ t: Math.round(performance.now()), op: name, store, key: null });
          } catch (e) { log.push({ t: 0, op: name, store, key: "?" }); }
          return orig.apply(this, arguments);
        };
      });
    }
    return window.__roomWrites.slice();
  });
}

export async function close() {
  if (!live) return;
  const b = live.browser;
  live = null;
  if (b) await b.close();
}
