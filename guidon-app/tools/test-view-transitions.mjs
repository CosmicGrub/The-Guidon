/**
 * Page-to-page cross-fade (the View Transitions API in route()).
 *
 * A route change asks the browser to cross-fade the old page into the new one
 * instead of hard-swapping it. It is a progressive enhancement, so what matters
 * most is every case where it must NOT happen, and that routing is never worse
 * off for it:
 *
 *  - a normal route change uses it and lands on the right page, and where
 *    focus ends up afterwards is EXACTLY where it ends up on a browser without
 *    the API (compared route by route - some pages move focus themselves);
 *  - the very first paint does not animate in (checked while onboarding's
 *    overlay is still up, before anything has navigated);
 *  - with reduced motion (the OS setting, emulated here) it is never started;
 *  - on a browser without the API, routing works exactly as before;
 *  - while onboarding owns the screen it is never started;
 *  - two route changes in quick succession (the browser SKIPS the first
 *    cross-fade and rejects its promises) still end on the LAST route, with a
 *    clean console - an unhandled "Transition was skipped" rejection is the
 *    failure this guards against;
 *  - an API that throws falls back to the plain swap instead of a blank page.
 *
 * One browser; separate contexts for the cases that need a different start.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

// Counts real calls without changing what the API does.
const SPY = () => {
  window.__vtCalls = 0;
  const real = document.startViewTransition;
  if (typeof real === "function") {
    document.startViewTransition = function (cb) { window.__vtCalls++; return real.call(document, cb); };
  }
};

async function open({ reducedMotion = "no-preference", init = SPY, dismiss = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion });
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  if (init) await page.addInitScript(init);
  await page.goto(url, { waitUntil: "load" });
  if (dismiss) await dismissOnboarding(page);
  return { ctx, page, noise };
}
const go = async (page, hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction((h) => location.hash === h && !!document.querySelector("#route h1, #route h2"), hash);
  await page.waitForTimeout(350); // longer than the 140ms cross-fade, so it has fully finished
};
const calls = (page) => page.evaluate(() => window.__vtCalls);
const focusInfo = (page) => page.evaluate(() => {
  const a = document.activeElement;
  const h = document.querySelector("#route h1, #route h2");
  return { tag: a ? a.tagName : null, cls: a ? String(a.className || "").slice(0, 60) : null, text: a ? (a.textContent || "").trim().slice(0, 50) : null, isHeading: !!h && a === h };
});
const FOCUS_ROUTES = ["#/board", "#/drills", "#/creeds", "#/progress"];
const focusByRoute = {};
const headingInfo = (page) => page.evaluate(() => {
  const h = document.querySelector("#route h1, #route h2");
  return { text: h ? h.textContent.trim() : null, focused: !!h && document.activeElement === h };
});

/* ---- 1. the normal case ------------------------------------------------ */
{
  const { ctx, page, noise } = await open();
  const supported = await page.evaluate(() => typeof document.startViewTransition === "function");
  supported ? ok("this browser has the View Transitions API, so the cases below really exercise it") : bad("the test browser has no document.startViewTransition - nothing below would prove anything");

  // Onboarding closing re-routes once into the new profile's Home - a real
  // page change, so it may cross-fade. The first PAINT is checked in case 5.
  const atBoot = await calls(page);

  await go(page, "#/drills");
  const afterOne = await calls(page);
  const h1 = await headingInfo(page);
  (afterOne === atBoot + 1 && h1.text)
    ? ok(`a route change starts exactly one cross-fade and lands on the new page ("${h1.text}")`)
    : bad(`after one route change: ${afterOne - atBoot} cross-fade(s), heading ${JSON.stringify(h1)}`);
  focusByRoute.withApi = {};
  for (const r of FOCUS_ROUTES) { await go(page, "#/home"); await go(page, r); focusByRoute.withApi[r] = await focusInfo(page); }

  // Rapid double navigation: the browser skips the first transition.
  const before = await calls(page);
  await page.evaluate(() => { location.hash = "#/creeds"; location.hash = "#/board"; });
  await page.waitForFunction(() => location.hash === "#/board" && !!document.querySelector("#route h1, #route h2"));
  await page.waitForTimeout(500);
  const onBoard = await page.evaluate(() => ({ hash: location.hash, routeChildren: document.querySelector("#route").children.length, text: (document.querySelector("#route").textContent || "").trim().length }));
  (onBoard.hash === "#/board" && onBoard.routeChildren === 1 && onBoard.text > 0)
    ? ok("two route changes in one tick end on the LAST route with exactly one rendered page (no stale page left behind, no blank page)")
    : bad("state after a rapid double navigation: " + JSON.stringify(onBoard));
  (await calls(page)) > before ? ok("the rapid double navigation did go through the cross-fade path (so the skipped-transition case was really exercised)") : bad("no cross-fade was started during the rapid double navigation");

  // Ten quick hops - the stress version of the same thing.
  await page.evaluate(async () => {
    const hops = ["#/home", "#/drills", "#/creeds", "#/board", "#/progress", "#/home", "#/train", "#/drills", "#/search", "#/home"];
    for (const h of hops) { location.hash = h; await new Promise((r) => setTimeout(r, 30)); }
  });
  await page.waitForFunction(() => location.hash === "#/home" && !!document.querySelector("#route h1, #route h2"));
  await page.waitForTimeout(600);
  noise.length === 0
    ? ok("no console errors or unhandled rejections, including after skipped cross-fades (a skipped transition rejects its ready/finished promises)")
    : bad("console noise: " + noise.slice(0, 6).join(" | "));
  await ctx.close();
}

/* ---- 2. reduced motion -------------------------------------------------- */
{
  const { ctx, page, noise } = await open({ reducedMotion: "reduce" });
  await go(page, "#/drills");
  await go(page, "#/board");
  const n = await calls(page);
  const h = await headingInfo(page);
  (n === 0 && h.text && h.focused)
    ? ok("with reduced motion on, no cross-fade is ever started, and routing plus heading focus work as before")
    : bad(`reduced motion: ${n} cross-fade(s) started, heading ${JSON.stringify(h)}`);
  const cssOff = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.media && /prefers-reduced-motion:\s*reduce/.test(r.media.mediaText)) {
          for (const inner of r.cssRules) if (/::view-transition/.test(inner.selectorText || "") && /none/.test(inner.style.animation || inner.style.animationName || "")) return true;
        }
      }
    }
    return false;
  });
  cssOff ? ok("the stylesheet also switches the cross-fade animation off under reduced motion (second guard, independent of the script)") : bad("no reduced-motion rule disabling ::view-transition animations was found");
  noise.length === 0 ? ok("clean console under reduced motion") : bad("console noise under reduced motion: " + noise.slice(0, 4).join(" | "));
  await ctx.close();
}

/* ---- 3. a browser without the API --------------------------------------- */
{
  const { ctx, page, noise } = await open({ init: () => { try { delete Document.prototype.startViewTransition; } catch (e) {} document.startViewTransition = undefined; } });
  const gone = await page.evaluate(() => typeof document.startViewTransition !== "function");
  await go(page, "#/drills");
  await go(page, "#/creeds");
  const h = await headingInfo(page);
  (gone && h.text && noise.length === 0)
    ? ok(`without the API (older Safari, older WebView) routing is unchanged: landed on "${h.text}", clean console`)
    : bad(`no-API case: apiGone=${gone}, heading ${JSON.stringify(h)}, noise ${JSON.stringify(noise.slice(0, 3))}`);
  focusByRoute.withoutApi = {};
  for (const r of FOCUS_ROUTES) { await go(page, "#/home"); await go(page, r); focusByRoute.withoutApi[r] = await focusInfo(page); }
  const differs = FOCUS_ROUTES.filter((r) => JSON.stringify(focusByRoute.withApi[r]) !== JSON.stringify(focusByRoute.withoutApi[r]));
  const headingRoutes = FOCUS_ROUTES.filter((r) => focusByRoute.withoutApi[r].isHeading);
  differs.length === 0
    ? ok(`after a route change, focus lands in exactly the same place with the cross-fade as without it, on all ${FOCUS_ROUTES.length} routes compared (${headingRoutes.length} of them on the page heading - the screen-reader announcement is unchanged)`)
    : bad("focus after a route change differs with the cross-fade on: " + differs.map((r) => r + " with=" + JSON.stringify(focusByRoute.withApi[r]) + " without=" + JSON.stringify(focusByRoute.withoutApi[r])).join(" ; "));
  headingRoutes.length >= 1 ? ok("at least one compared route really does move focus to its heading, so the comparison above is not vacuous") : bad("none of the compared routes focus their heading - the comparison proves nothing; pick other routes");
  await ctx.close();
}

/* ---- 4. an API that throws ---------------------------------------------- */
{
  const { ctx, page } = await open({ init: () => { document.startViewTransition = function () { throw new Error("planted: startViewTransition is broken"); }; } });
  await go(page, "#/drills");
  const h = await headingInfo(page);
  h.text ? ok(`an API that throws falls back to the plain swap instead of leaving a blank page (landed on "${h.text}")`) : bad("a throwing startViewTransition left the page without a rendered view");
  await ctx.close();
}

/* ---- 5. onboarding owns the screen -------------------------------------- */
{
  const { ctx, page } = await open({ dismiss: false });
  await page.waitForSelector("#ob-overlay", { timeout: 8000 }).catch(() => {});
  const hasOverlay = await page.evaluate(() => !!document.getElementById("ob-overlay"));
  if (!hasOverlay) bad("onboarding's overlay did not appear on a fresh profile, so this case could not be exercised");
  else {
    const firstPaint = await calls(page);
    firstPaint === 0
      ? ok("the first paint started no cross-fade - the app does not animate in over an empty shell")
      : bad("cross-fades were started during the first paint: " + firstPaint);
    await page.evaluate(() => { location.hash = "#/drills"; });
    await page.waitForTimeout(500);
    const n = await calls(page);
    n === 0 ? ok("while onboarding's overlay is open a route change starts no cross-fade (its focus trap is left alone)") : bad("cross-fades started behind the onboarding overlay: " + n);
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(fails === 0 ? "\nVIEW TRANSITIONS: all passed" : `\nVIEW TRANSITIONS: ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
