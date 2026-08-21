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
import { serve } from "./server.mjs";

const WEB = process.argv[2] || "web";
const SETTLE_NAV = 250;
const SETTLE_THEME = 700; // > longest transition; phantom failures below this

// Real CSS viewports (physical / DPR), matching masterfile §41 - except
// tabS9-portrait, corrected during the intuitivism pass (2026-08-20).
// §41 had recorded 720x1152 labeled "physical / DPR, not guessed," which
// contradicted the intuitivism plan's own separate ~823px figure. Resolved
// for real this time, not by picking a side: a Tab S9 FE (SM-X518U) was
// connected via adb for this session, so this was read directly from the
// live installed app's own WebView over CDP - window.innerWidth === 823,
// window.devicePixelRatio === 1.75 - not computed, not guessed. §41's 720
// was wrong. GUIDON_MASTERFILE.md §41 corrected to match; see its own note
// there for the same real-hardware citation.
const VIEWPORTS = [
  { name: "fold-closed", width: 344, height: 882 },
  { name: "phone-360", width: 360, height: 780 },
  { name: "fold-open", width: 673, height: 841 },
  { name: "tabS9-portrait", width: 823, height: 1286 },
  { name: "tabS9-landscape", width: 1152, height: 720 },
  { name: "desktop", width: 1440, height: 900 },
];

const results = { pass: [], fail: [], info: {} };
const ok = (m) => { results.pass.push(m); console.log("  PASS  " + m); };
const bad = (m) => { results.fail.push(m); console.log("  FAIL  " + m); };

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

    // Every route: no overflow, no console noise.
    let overflow = 0;
    for (const r of results.info.routes) {
      await page.evaluate((h) => { location.hash = h; }, r);
      await page.waitForTimeout(SETTLE_NAV);
      const o = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        wide: [...document.querySelectorAll("body *")].filter(
          (el) => el.getBoundingClientRect().width > window.innerWidth + 1
        ).length,
      }));
      if (o.doc > 1 || o.wide > 0) { overflow++; bad(`overflow at ${r}: doc=${o.doc} wideEls=${o.wide}`); }
    }
    if (!overflow) ok(`no horizontal overflow across ${results.info.routes.length} sections @1440px`);

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
    external.length === 0 ? ok("zero external requests") : bad("external requests: " + external.slice(0, 5).join(", "));
    await extCtx.close();

    // ---------- 5. responsive sweep ----------
    console.log("\n[5] Responsive sweep across real viewports");
    for (const vp of VIEWPORTS) {
      const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.width < 900 });
      const p = await c.newPage();
      const vmsgs = [];
      p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") vmsgs.push(m.text()); });
      p.on("pageerror", (e) => vmsgs.push("pageerror: " + e.message));
      await p.goto(url, { waitUntil: "load" });
      await p.waitForTimeout(SETTLE_NAV);
      let badCount = 0;
      for (const r of results.info.routes) {
        await p.evaluate((h) => { location.hash = h; }, r);
        await p.waitForTimeout(120);
        const o = await p.evaluate(() => ({
          doc: document.documentElement.scrollWidth - window.innerWidth,
          wide: [...document.querySelectorAll("body *")].filter(
            (el) => el.getBoundingClientRect().width > window.innerWidth + 1
          ).length,
        }));
        if (o.doc > 1 || o.wide > 0) { badCount++; bad(`${vp.name} overflow @${r} doc=${o.doc} wide=${o.wide}`); }
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

  console.log("\n" + "=".repeat(64));
  console.log(`RESULT: ${results.pass.length} pass, ${results.fail.length} fail`);
  if (results.fail.length) { console.log("\nFAILURES:"); results.fail.forEach((f) => console.log("  - " + f)); }
  console.log("=".repeat(64));
  process.exit(results.fail.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
