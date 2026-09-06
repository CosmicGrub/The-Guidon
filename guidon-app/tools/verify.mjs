/**
 * GUIDON verification harness.
 *
 * Built to this project's standing rules (GUIDON_PROJECT_MAP.md §8):
 *   - capture console "warning" as well as "error" (a ReferenceError hid for two
 *     sessions behind an error-only filter)
 *   - derive the section list from G.routes, never hand-maintain it
 *   - settle after theme changes as well as after navigation, longer than the
 *     longest CSS transition, before sampling anything colour-related
 *
 * Usage: node tools/verify.mjs [webDir]
 */
import { chromium, devices } from "playwright";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "./server.mjs";
import { probeViaPlaywright, writeProbe } from "./caps-probe.mjs";

const WEB = process.argv[2] || "web";
const SETTLE_NAV = 250;
const SETTLE_THEME = 700; // > longest transition; phantom failures below this

// Real CSS viewports (physical / DPR), matching masterfile §41 - except
// tabS9-portrait, corrected during the intuitivism pass (2026-08-20).
// §41 had recorded 720x1152 labeled "physical / DPR, not guessed," which
// contradicted the intuitivism plan's own separate ~823px figure. Resolved
// for real this time, not by picking a side: a Tab S9 FE (SM-X518U) was
// connected via adb for this session, so width was read directly from the
// live installed app's own WebView over CDP - window.innerWidth === 823,
// window.devicePixelRatio === 1.75 - not computed, not guessed. §41's 720
// was wrong. Height (1317) is the physical/DPR division (2304/1.75), not a
// separate CDP read (a second attempt to reattach and read
// window.innerHeight directly hung mid-session and wasn't retried) - it
// also matches the system's own rotation report for the swapped
// orientation (w1317dp h823dp), so it's corroborated, just not
// independently CDP-measured the way width/DPR are. GUIDON_MASTERFILE.md
// §41 corrected to match; see its own note there.
const VIEWPORTS = [
  { name: "fold-closed", width: 344, height: 882 },
  { name: "phone-360", width: 360, height: 780 },
  { name: "fold-open", width: 673, height: 841 },
  { name: "tabS9-portrait", width: 823, height: 1317 },
  { name: "tabS9-landscape", width: 1152, height: 720 },
  { name: "desktop", width: 1440, height: 900 },
  // Desktop window shapes (added 2026-09-03): a short laptop window, a
  // half-snapped 1366x768 laptop, and the Tauri minimum. They are desktop
  // pointer shapes, so touch: false overrides section 5's width<900 touch
  // heuristic (which exists for the phone/fold rows above).
  { name: "desktop-short", width: 1280, height: 450, touch: false },
  { name: "snap-half-1366", width: 683, height: 728, touch: false },
  { name: "win-min", width: 360, height: 480, touch: false },
];

const results = { pass: [], fail: [], known: [], info: {} };
// Measured defects that are pinned, not fixed (same mechanism as
// tools/test-resize-storm.mjs): a bad() whose message matches a pin is
// printed as KNOWN and counted in results.known so the tree stays runnable
// end to end. A pin that matches nothing is itself a FAIL (the defect no
// longer reproduces - remove the pin). Exit code ignores known.
const EXPECTED_DEFECTS = [
  // (empty) The desktop-short auto-theater pin (1280x450, no touch, #/board
  // load entered theater) was closed by S3, pointer-gated auto-theater,
  // 2026-09-04 - that row is now an ordinary PASS/FAIL like every other.
];
// One overflow probe for sections 1 and 5. wide>0 names the widest offender
// (tag, first class, rounded px) in the message itself, so a failure is
// self-diagnosing: measured 2026-09-04, a bare "wide=1" at win-min @#/board
// took a full per-card sweep to attribute (that sweep is now
// tools/test-board-card-overflow.mjs, which steps every card).
// Message prefixes ("<vp> overflow @<route>", "overflow at <route>:") are
// unchanged; the detail is appended in parentheses only when wide > 0.
const OVERFLOW_PROBE = () => {
  const iw = window.innerWidth;
  let wide = 0, widest = null;
  for (const el of document.querySelectorAll("body *")) {
    const w = el.getBoundingClientRect().width;
    if (w > iw + 1) { wide++; if (!widest || w > widest.w) widest = { el, w }; }
  }
  const cls = widest ? (widest.el.getAttribute("class") || "").split(/\s+/).filter(Boolean)[0] : "";
  return {
    doc: document.documentElement.scrollWidth - iw,
    wide,
    widest: widest ? widest.el.tagName.toLowerCase() + (cls ? "." + cls : "") + " " + Math.round(widest.w) + "px" : "",
  };
};
const fmtWide = (o) => (o.wide > 0 ? ` (${o.widest})` : "");
const ok = (m) => { results.pass.push(m); console.log("  PASS  " + m); };
const bad = (m) => {
  const pin = EXPECTED_DEFECTS.find((p) => p.match.test(m));
  if (pin) { pin.hits = (pin.hits || 0) + 1; results.known.push(m); console.log("  KNOWN " + m); return; }
  results.fail.push(m); console.log("  FAIL  " + m);
};

async function main() {
  const { server, url } = await serve(WEB);
  console.log("serving " + WEB + " at " + url + "\n");
  const browser = await chromium.launch();

  try {
    // ---------- 1. boot health, routes, console cleanliness ----------
    console.log("[1] Boot health + route sweep");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const msgs = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") msgs.push(`${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => msgs.push("pageerror: " + e.message));

    const t0 = Date.now();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(SETTLE_NAV);
    results.info.loadMs = Date.now() - t0;

    const perf = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] || {};
      return {
        domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
        loadEvent: Math.round(n.loadEventEnd || 0),
        transferSize: n.transferSize || 0,
        fcp: Math.round((performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || 0),
      };
    });
    results.info.perf = perf;
    console.log("  timing:", JSON.stringify(perf));

    const routes = await page.evaluate(() => (window.G && window.G.routes ? window.G.routes.map((r) => r.hash || r) : null));
    if (!routes || !routes.length) bad("G.routes not exposed - cannot derive section list");
    else ok(`G.routes exposed: ${routes.length} sections`);
    results.info.routes = routes || [];

    // Every route: no overflow, no console noise, and a per-route document
    // title (S5, 2026-09-04): route() sets "GUIDON - <label>" from the
    // matched ROUTES entry, so the expected label is read from the live
    // G.routes entry in-page - never a hand list here.
    let overflow = 0;
    let badTitles = 0;
    for (const r of results.info.routes) {
      await page.evaluate((h) => { location.hash = h; }, r);
      await page.waitForTimeout(SETTLE_NAV);
      const o = await page.evaluate(OVERFLOW_PROBE);
      if (o.doc > 1 || o.wide > 0) { overflow++; bad(`overflow at ${r}: doc=${o.doc} wideEls=${o.wide}${fmtWide(o)}`); }
      const label = await page.evaluate((h) => {
        const e = (window.G.routes || []).find((x) => x.hash === h);
        return e && e.label ? String(e.label) : "";
      }, r);
      const title = await page.title();
      const expected = label ? "GUIDON - " + label : "GUIDON";
      if (title !== expected || (label && !title.endsWith(label))) {
        badTitles++;
        bad(`document.title at ${r}: got ${JSON.stringify(title)}, expected ${JSON.stringify(expected)}`);
      }
    }
    if (!overflow) ok(`no horizontal overflow across ${results.info.routes.length} sections @1440px`);
    if (!badTitles) ok(`document.title is "GUIDON - <label>" on every one of ${results.info.routes.length} routes`);

    // ---------- 1b. fork marker + capability probe (collective P2) ----------
    // The fork marker is stamped by tools/build.mjs per output, never by the
    // shared src/index.html: "web" here, "standalone" in dist/ (asserted by
    // tools/test-standalone.mjs). The probe is the app's own GUIDON_CAPS
    // console sentinel from #/selftest?probe=1, written as
    // artifacts/caps/chromium-web.json for tools/caps-matrix.mjs (artifacts/
    // is gitignored - confirmed in guidon-app/.gitignore). Playwright's
    // Chromium is the shipping engine family for web/pwa/tauri/android, so
    // this file IS ship evidence; loopback:false because the page under test
    // is the real build, not a fixture.
    const fork = await page.evaluate(() => window.GUIDON_FORK);
    fork === "web" ? ok('GUIDON_FORK === "web" (stamped by build.mjs into web/index.html)') : bad("GUIDON_FORK = " + JSON.stringify(fork) + ' in web/index.html (expected "web")');
    const capsPayload = await probeViaPlaywright(page);
    if (!capsPayload) bad("no GUIDON_CAPS sentinel within 8s of #/selftest?probe=1 - the build lacks the capability probe");
    else {
      const n = Object.keys(capsPayload.caps || {}).length;
      const supported = Object.values(capsPayload.caps || {}).filter(Boolean).length;
      const file = await writeProbe({ engine: "chromium", device: "web", collector: "tools/verify.mjs", payload: capsPayload });
      ok(`capability probe captured (${supported}/${n} supported, fork ${capsPayload.fork}, sha ${String(capsPayload.sha).slice(0, 7)}) -> ${file}`);
      results.info.caps = capsPayload;
    }
    await page.evaluate(() => { location.hash = "#/home"; });
    await page.waitForTimeout(SETTLE_NAV);

    // ---------- 2. installability / PWA ----------
    console.log("\n[2] PWA installability");
    const manifestHref = await page.evaluate(() => {
      const l = document.querySelector('link[rel="manifest"]');
      return l ? l.href : null;
    });
    if (!manifestHref) bad("no <link rel=manifest>");
    else if (manifestHref.startsWith("data:")) bad("manifest is a data: URI - Chromium will not install it");
    else ok("manifest is a real fetchable URL: " + manifestHref.replace(url, "/"));

    if (manifestHref && !manifestHref.startsWith("data:")) {
      const mf = await page.evaluate(async (h) => {
        const r = await fetch(h);
        return { status: r.status, ct: r.headers.get("content-type"), body: await r.json() };
      }, manifestHref);
      results.info.manifest = mf.body;
      const m = mf.body;
      mf.status === 200 ? ok("manifest fetches 200") : bad("manifest status " + mf.status);
      m.name ? ok("manifest.name") : bad("manifest.name missing");
      m.start_url ? ok("manifest.start_url = " + m.start_url) : bad("start_url missing");
      ["standalone", "fullscreen", "minimal-ui"].includes(m.display)
        ? ok("manifest.display = " + m.display)
        : bad("display must be standalone/fullscreen/minimal-ui, got " + m.display);

      const icons = m.icons || [];
      const png = icons.filter((i) => (i.type || "").includes("png"));
      const has192 = png.some((i) => (i.sizes || "").split(/\s+/).includes("192x192"));
      const has512 = png.some((i) => (i.sizes || "").split(/\s+/).includes("512x512"));
      has192 ? ok("PNG 192x192 icon present") : bad("no PNG 192x192 icon");
      has512 ? ok("PNG 512x512 icon present") : bad("no PNG 512x512 icon");

      const maskable = icons.filter((i) => (i.purpose || "").includes("maskable"));
      const anyOnly = icons.filter((i) => (i.purpose || "any") === "any" || (i.purpose || "").split(/\s+/).includes("any"));
      maskable.length ? ok("maskable icon declared") : bad("no maskable icon");
      anyOnly.length ? ok("'any' purpose icon declared") : bad("no 'any' purpose icon");
      if (icons.some((i) => (i.purpose || "").includes("any") && (i.purpose || "").includes("maskable")))
        bad("an icon declares BOTH any+maskable - it will be cropped as maskable; declare separately");

      // every icon must actually load
      for (const i of icons) {
        const r = await page.evaluate(async (src) => {
          try { const rr = await fetch(src); return rr.status; } catch { return 0; }
        }, new URL(i.src, manifestHref).href);
        r === 200 ? ok(`icon loads: ${i.src} (${i.sizes})`) : bad(`icon ${i.src} -> HTTP ${r}`);
      }
    }

    const appleIcon = await page.evaluate(() => !!document.querySelector('link[rel="apple-touch-icon"]'));
    appleIcon ? ok("apple-touch-icon present (iOS home screen)") : bad("no apple-touch-icon - iOS uses a screenshot");

    // ---------- 2b. sw.js PRECACHE completeness ----------
    // Every icon this page's own <link>/manifest actually references must
    // also be in sw.js's PRECACHE array, or it is not actually offline-ready
    // on first boot - it just falls back to a network fetch. This is exactly
    // how icon-48.png drifted (GUIDON roadmap Tier 2): it shipped and was
    // linked from a real <link rel="icon" sizes="48x48"> tag (built by
    // build.mjs), but src/sw.js's PRECACHE array used to be a 4th
    // independently hand-typed copy of the icon list and nobody had updated
    // it. PRECACHE is now generated at build time from tools/icon-spec.mjs
    // (see build.mjs's sw.js section), so this check compares two things
    // neither of which is hand-typed here: the icons the live page actually
    // links/declares, against the actual PRECACHE array in the actual built
    // web/sw.js on disk. A regression in either direction - a linked icon
    // that stops being precached, or icon-spec.mjs drifting from what's
    // really linked - fails this.
    console.log("\n[2b] sw.js PRECACHE completeness (every linked icon offline-ready)");
    const linkedIconPaths = await page.evaluate(() => {
      const hrefs = new Set();
      document.querySelectorAll('link[rel="icon"][href], link[rel="apple-touch-icon"][href]').forEach((l) => {
        const href = l.getAttribute("href");
        if (href && !href.startsWith("data:")) hrefs.add(new URL(href, location.href).pathname);
      });
      return [...hrefs];
    });
    if (results.info.manifest && Array.isArray(results.info.manifest.icons)) {
      for (const i of results.info.manifest.icons) {
        if (i.src) linkedIconPaths.push(new URL(i.src, manifestHref).pathname);
      }
    }
    const uniqueLinkedIcons = [...new Set(linkedIconPaths)];
    if (!uniqueLinkedIcons.length) {
      bad("no same-origin icon <link>/manifest entries found on the page to check against PRECACHE");
    } else {
      let swText = "";
      try { swText = await readFile(join(WEB, "sw.js"), "utf8"); } catch (e) {}
      // sw.js embeds PRECACHE as JSON.parse("...") (see seedAsJsonParse-style
      // double-stringify in build.mjs), so unwind that one layer before the
      // real JSON.parse of the array itself.
      const m = swText.match(/const PRECACHE = JSON\.parse\("(.*)"\);/);
      if (!m) {
        bad(`could not find a "const PRECACHE = JSON.parse(...)" literal in ${join(WEB, "sw.js")}`);
      } else {
        let precache = null;
        try { precache = JSON.parse(JSON.parse('"' + m[1] + '"')); } catch (e) {}
        if (!Array.isArray(precache)) {
          bad("web/sw.js PRECACHE did not decode to a JSON array");
        } else {
          const precacheNorm = new Set(precache.map((p) => p.replace(/^\.\//, "/")));
          const missing = uniqueLinkedIcons.filter((p) => !precacheNorm.has(p));
          missing.length
            ? bad(`linked icon(s) missing from web/sw.js PRECACHE, not offline-ready on first boot: ${missing.join(", ")}`)
            : ok(`every linked icon (${uniqueLinkedIcons.length}) is in web/sw.js PRECACHE: ${uniqueLinkedIcons.join(", ")}`);
        }
      }
    }

    // ---------- 3. service worker + real offline ----------
    console.log("\n[3] Service worker + offline");
    const swReady = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { ok: false, why: "unsupported" };
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((r) => setTimeout(() => r(null), 15000)),
        ]);
        return reg ? { ok: true, scope: reg.scope, active: !!reg.active } : { ok: false, why: "timeout" };
      } catch (e) { return { ok: false, why: String(e) }; }
    });
    swReady.ok ? ok("service worker active, scope " + swReady.scope) : bad("service worker not active: " + swReady.why);

    if (swReady.ok) {
      // Give the SW a moment to finish precaching, then kill the network entirely.
      await page.waitForTimeout(2500);
      const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        let n = 0;
        for (const k of names) n += (await (await caches.open(k)).keys()).length;
        return { names, n };
      });
      cached.n > 0 ? ok(`precache populated: ${cached.n} entries in [${cached.names}]`) : bad("cache storage empty");

      const offCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const offPage = await offCtx.newPage();
      await offPage.goto(url, { waitUntil: "load" });
      await offPage.waitForTimeout(3000); // let SW install+activate in this context
      await offCtx.setOffline(true);
      const reloaded = await offPage
        .reload({ waitUntil: "load", timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (!reloaded) bad("OFFLINE reload failed");
      else {
        const alive = await offPage.evaluate(
          () => !!document.querySelector("#app") && !!(window.G && window.G.routes)
        );
        alive ? ok("OFFLINE reload works - app boots with network disabled") : bad("offline reload served a shell but app did not boot");
      }
      await offCtx.close();
    }

    // ---------- 4. no external network requests (offline guarantee) ----------
    // "No server, ever" promise, P1 (desktop roadmap, locked decision Q1):
    // this audit is scoped to OUTSIDE A STUDY SESSION - it loads the app
    // with study groups at their default (off) and fails on any request
    // not served from this origin. P4 (the first LAN study-room socket)
    // must teach this audit to allow ONLY the room's ws:// origin while a
    // session is open (studyGroups on + a G.netLedger entry naming that
    // peer), and keep failing on everything else, in the same change that
    // adds the socket. The in-app twin of this rule is the Diagnostics
    // "No external requests" check (selftest AUTO id "offline").
    console.log("\n[4] External request audit");
    const extCtx = await browser.newContext();
    const extPage = await extCtx.newPage();
    const external = [];
    extPage.on("request", (r) => {
      const u = r.url();
      if (!u.startsWith(url) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
    });
    await extPage.goto(url, { waitUntil: "load" });
    await extPage.waitForTimeout(1500);
    // PRIVACY.md ("What GUIDON is") promises this audit walks EVERY screen,
    // not just the boot route: a lazy view that references an outside URL
    // only when it renders would pass a root-only load. Same route list as
    // section 1 (derived from G.routes in-page, never a hand list).
    for (const r of results.info.routes) {
      await extPage.evaluate((h) => { location.hash = h; }, r);
      await extPage.waitForTimeout(SETTLE_NAV);
    }
    await extPage.waitForTimeout(500);
    external.length === 0
      ? ok(`zero external requests across boot + all ${results.info.routes.length} sections`)
      : bad("external requests: " + external.slice(0, 5).join(", "));
    await extCtx.close();

    // ---------- 5. responsive sweep ----------
    console.log("\n[5] Responsive sweep across real viewports");
    for (const vp of VIEWPORTS) {
      const ctxOpts = { viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch ?? (vp.width < 900) };
      let c, p;
      try { c = await browser.newContext(ctxOpts); p = await c.newPage(); }
      catch (e) {
        // Measured 2026-09-04 inside npm test: one Chromium renderer target
        // crashed while opening the 4th viewport context (this laptop's GPU is
        // a known hazard; the same run passed alone). Retry ONCE, visibly, so a
        // single transient crash is recorded rather than fatal; a second crash
        // still throws and fails the run.
        if (!/crashed/i.test(String(e))) throw e;
        console.log("  WARN  " + vp.name + ": browser target crashed opening the context - retrying once (" + String(e).split(String.fromCharCode(10))[0] + ")");
        results.info.targetCrashes = (results.info.targetCrashes || 0) + 1;
        try { if (c) await c.close(); } catch (_) {}
        c = await browser.newContext(ctxOpts); p = await c.newPage();
      }
      const vmsgs = [];
      p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") vmsgs.push(m.text()); });
      p.on("pageerror", (e) => vmsgs.push("pageerror: " + e.message));
      await p.goto(url, { waitUntil: "load" });
      await p.waitForTimeout(SETTLE_NAV);
      let badCount = 0;
      for (const r of results.info.routes) {
        await p.evaluate((h) => { location.hash = h; }, r);
        await p.waitForTimeout(120);
        // At-load overflow. This read is deliberately the FIRST thing done
        // on a route, before the theater read and before the #/board card
        // activation + exitTheater() further down, so a card open/close
        // transition can never contaminate the at-load number; the card-
        // open path has its own, separately named read below.
        const o = await p.evaluate(OVERFLOW_PROBE);
        if (o.doc > 1 || o.wide > 0) { badCount++; bad(`${vp.name} overflow @${r} doc=${o.doc} wide=${o.wide}${fmtWide(o)}`); }
        // Board Drill theater mode must never engage on its own at load.
        // Marker is the one the app itself toggles (src/index.html
        // theaterOn(): html.qz-theater), same as the resize storm's SNAP.
        // Board Drill's mount-time auto-theater is a 220ms setTimeout
        // (src/index.html G.board._autoTheaterTimer), longer than the 120ms
        // route settle above - wait past it on #/board or the at-load read
        // can never see it (measured 2026-09-03: 1280x450 marker is set
        // ~220ms after the hash change, no card click needed).
        if (r === "#/board") await p.waitForTimeout(300);
        const theaterAtLoad = await p.evaluate(() => document.documentElement.classList.contains("qz-theater"));
        if (theaterAtLoad) { badCount++; bad(`${vp.name} auto-theater engaged @${r}`); }
        if (r === "#/board") {
          // Activate the first card the way the storm does, then re-check:
          // the category-click path has its own auto-theater check.
          const clicked = await p.evaluate(() => { const row = document.querySelector(".list-detail-row"); if (row) { row.click(); return true; } return false; });
          await p.waitForTimeout(800);
          if (!clicked) bad(`${vp.name}: no .list-detail-row on #/board to activate a card`);
          const theaterActive = await p.evaluate(() => document.documentElement.classList.contains("qz-theater"));
          if (theaterActive && !theaterAtLoad) { badCount++; bad(`${vp.name} auto-theater engaged @${r} after card activation`); }
          // The card-open path is overflow-checked as its own assertion so
          // it is never mistaken for the at-load read above.
          const oc = await p.evaluate(OVERFLOW_PROBE);
          if (oc.doc > 1 || oc.wide > 0) { badCount++; bad(`${vp.name} overflow after card activation @${r} doc=${oc.doc} wide=${oc.wide}${fmtWide(oc)}`); }
          await p.evaluate(() => { if (window.G && window.G.board && window.G.board.exitTheater) window.G.board.exitTheater(); });
          // Bounded settle, not a fixed sleep: poll every 50ms (up to
          // 1000ms) until html.qz-theater is gone AND nothing is wider
          // than the viewport, so the next route's at-load read never
          // starts on top of a still-collapsing overlay. A theater class
          // that survives the whole window is a failure in its own right;
          // a still-wide element is not re-reported here (the named read
          // just above already owns it).
          const settle = await p.evaluate(async () => {
            for (let t = 0; t <= 1000; t += 50) {
              const theater = document.documentElement.classList.contains("qz-theater");
              const wide = [...document.querySelectorAll("body *")].some((el) => el.getBoundingClientRect().width > window.innerWidth + 1);
              if (!theater && !wide) return { t, theater };
              await new Promise((res) => setTimeout(res, 50));
            }
            return { t: -1, theater: document.documentElement.classList.contains("qz-theater") };
          });
          if (settle.t < 0 && settle.theater) { badCount++; bad(`${vp.name}: html.qz-theater still set 1000ms after exitTheater() @${r}`); }
        }
      }
      if (!badCount) ok(`${vp.name} (${vp.width}x${vp.height}): clean across ${results.info.routes.length} sections`);
      if (vmsgs.length) bad(`${vp.name}: ${vmsgs.length} console error/warning -> ${vmsgs[0]}`);
      await c.close();
    }

    // ---------- 6. console cleanliness (main context, after full sweep) ----------
    console.log("\n[6] Console");
    msgs.length === 0 ? ok("zero console errors/warnings across full route sweep")
                      : bad(`${msgs.length} console msgs; first: ${msgs[0]}`);
    results.info.consoleMsgs = msgs.slice(0, 20);

    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }

  for (const pin of EXPECTED_DEFECTS) {
    if (pin.hits) continue;
    const m = "expected defect did not reproduce - remove its pin: " + pin.why;
    results.fail.push(m); console.log("  FAIL  " + m);
  }
  console.log("\n" + "=".repeat(64));
  console.log(`RESULT: ${results.pass.length} pass, ${results.fail.length} fail, ${results.known.length} known`);
  if (results.known.length) results.known.forEach((k) => console.log("  known: " + k));
  if (results.fail.length) { console.log("\nFAILURES:"); results.fail.forEach((f) => console.log("  - " + f)); }
  console.log("=".repeat(64));
  process.exit(results.fail.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
