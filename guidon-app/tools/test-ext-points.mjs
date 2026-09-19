/**
 * Named extension points (G.ext) and the three launch panels that use them.
 *
 * Why this exists: the 2026-09 feature modules put their launch panels on
 * Board Drill, Leadership Drills and Physical Readiness by REPLACING
 * G.board.render, G.drills.render and G.views.prt with wrappers
 * (src/app-modules/00-roadmap-bootstrap.js, wrapRender). That only held while
 * no other module wrapped the same function and the file happened to load
 * first. Core now declares where it may be extended - G.ext.run("board:
 * rendered" | "drills:rendered" | "prt:rendered", mount) at the end of those
 * three renders - and the module subscribes with G.ext.on. This suite drives
 * the real screens and holds both halves:
 *
 *  THE PANELS LOOK AND BEHAVE AS BEFORE
 *   - each screen shows its launch panel exactly once, as the LAST thing on
 *     the screen, with the same heading, copy and buttons, and each button
 *     opens the screen it names;
 *   - a redraw of the same screen (Board Drill's own re-render, Physical
 *     Readiness "Run the drill" -> End) brings the panel back, once;
 *   - nothing scrolls sideways at 344px with the panels on screen.
 *  THE WIRING IS DECLARED, NOT PATCHED
 *   - the three renders are core's own functions again (the wrapper marked
 *     its replacement with _roadmapWrapped; that mark is gone);
 *   - a handler runs AFTER the screen is drawn - including Leadership Drills,
 *     whose render is async - and is handed the screen's mount element;
 *   - a handler that throws, or returns a promise that rejects, is logged and
 *     skipped: the host screen finishes, and the other handlers still run;
 *   - a misspelt point name is refused out loud by on() and by run(), so a
 *     handler can never be registered somewhere it will silently never run.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { loadModules } from "./module-manifest.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));

const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 344, height: 882 } });
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);

const PANELS = [
  { hash: "#/board", point: "board:rendered", title: "Board Simulator", heading: "Board Drill", drawn: ".segmented",
    copyStarts: "Rehearse a whole board appearance in one sitting", buttons: [["Open Board Simulator", "#/board-sim", "Board Simulator"]] },
  { hash: "#/drills", point: "drills:rendered", title: "Collective leader tools", heading: "Leadership Drills", drawn: ".card-results-grid",
    copyStarts: "Optional team-development and PT-planning surfaces", buttons: [["Team Training", "#/team", "Team Training"], ["PT Planner", "#/pt-plan", "PT Planner"]] },
  { hash: "#/prt", point: "prt:rendered", title: "Plan the week", heading: "Physical Readiness", drawn: ".list-detail",
    copyStarts: "Turn the verified PRT reference", buttons: [["Open PT Planner", "#/pt-plan", "PT Planner"]] },
];

const go = async (hash, headingText) => {
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForFunction(() => location.hash === "#/home");
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction((t) => { const h = document.querySelector("#route h2"); return !!h && h.textContent.trim() === t; }, headingText, { timeout: 15000 });
};
const panelInfo = (title) => page.evaluate((t) => {
  const all = Array.from(document.querySelectorAll("#route [data-roadmap-launch]"));
  const p = all.filter((x) => x.getAttribute("data-roadmap-launch") === t)[0] || null;
  if (!p) return { count: 0, total: all.length };
  const frame = p.parentElement;
  return {
    count: all.filter((x) => x.getAttribute("data-roadmap-launch") === t).length, total: all.length,
    isLast: frame.lastElementChild === p,
    eyebrow: (p.querySelector(".eyebrow") || {}).textContent || "",
    copy: (p.querySelector("p.hint") || {}).textContent || "",
    buttons: Array.from(p.querySelectorAll(".btn-row button")).map((b) => ({ text: b.textContent, type: b.getAttribute("type"), cls: b.className })),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
}, title);

/* ---- the registry itself ---- */
const api = await page.evaluate(() => ({
  has: !!(window.G && G.ext), points: G.ext && G.ext.points ? G.ext.points() : null,
  counts: G.ext && G.ext.count ? G.ext.points().map((n) => G.ext.count(n)) : null,
  wrapped: [G.board.render._roadmapWrapped, G.drills.render._roadmapWrapped, G.views.prt._roadmapWrapped].map((v) => v === true),
}));
check(api.has && JSON.stringify(api.points) === JSON.stringify(PANELS.map((p) => p.point)), `core declares its extension points: ${JSON.stringify(api.points)}`, "G.ext.points() is " + JSON.stringify(api.points));
// How many subscribers a point SHOULD have is the manifest's to say ("hooks"), not a number kept here:
// the day a second module subscribes to one of them, this must not fail for the wrong reason.
const declaredHooks = loadModules().modules.flatMap((m) => m.hooks || []);
const wantCounts = PANELS.map((p) => declaredHooks.filter((h) => h === p.point).length);
check(api.counts && JSON.stringify(api.counts) === JSON.stringify(wantCounts) && wantCounts.every((n) => n >= 1),
  `each point has exactly the subscribers the manifest's "hooks" declare (${JSON.stringify(wantCounts)}; at least the launch panel on each)`,
  `subscriber counts ${JSON.stringify(api.counts)}, but the manifest's "hooks" declare ${JSON.stringify(wantCounts)}`);
check(api.wrapped.every((w) => w === false), "G.board.render, G.drills.render and G.views.prt are core's own functions - no module has replaced them with a wrapper", "still wrapped (board, drills, prt): " + JSON.stringify(api.wrapped));

/* ---- each panel: once, last, same words, buttons work ---- */
for (const P of PANELS) {
  await go(P.hash, P.heading);
  await page.waitForFunction((t) => !!document.querySelector("#route [data-roadmap-launch='" + t + "']"), P.title, { timeout: 15000 }).catch(() => {});
  const info = await panelInfo(P.title);
  check(info.count === 1 && info.total === 1, `${P.hash}: the "${P.title}" launch panel is on the screen exactly once`, `${P.hash}: panel count ${JSON.stringify(info)}`);
  if (!info.count) continue;
  check(info.isLast, `${P.hash}: it is the last thing on the screen, below everything the screen itself draws`, `${P.hash}: the panel is not the last element of the screen`);
  check(info.eyebrow === P.title && info.copy.startsWith(P.copyStarts), `${P.hash}: same heading and copy as before`, `${P.hash}: heading/copy changed: ${JSON.stringify([info.eyebrow, info.copy.slice(0, 80)])}`);
  check(JSON.stringify(info.buttons.map((b) => b.text)) === JSON.stringify(P.buttons.map((b) => b[0])) && info.buttons.every((b) => b.type === "button" && /\bbtn\b/.test(b.cls) && /\bghost\b/.test(b.cls)),
    `${P.hash}: same buttons (${P.buttons.map((b) => b[0]).join(", ")})`, `${P.hash}: buttons are ${JSON.stringify(info.buttons)}`);
  check(info.overflow <= 0, `${P.hash}: nothing scrolls sideways at 344px with the panel on screen`, `${P.hash}: ${info.overflow}px of sideways scroll`);
  for (const [label, target, targetHeading] of P.buttons) {
    await go(P.hash, P.heading);
    const btn = page.locator(`#route [data-roadmap-launch='${P.title}'] .btn-row button`, { hasText: new RegExp("^" + label + "$") });
    await btn.waitFor({ state: "visible", timeout: 15000 });
    // Focus only takes once the route change has settled (measured the same
    // on the build before this change: a focus() in the first ~300 ms after
    // navigation is dropped), so keep asking until the button really has it.
    await page.waitForFunction(([t, l]) => {
      const b = Array.from(document.querySelectorAll("#route [data-roadmap-launch='" + t + "'] .btn-row button")).filter((x) => x.textContent === l)[0];
      if (!b) return false;
      b.focus();
      return document.activeElement === b;
    }, [P.title, label], { timeout: 15000 }).catch(() => {});
    const focused = await page.evaluate(() => ((document.activeElement && document.activeElement.textContent) || "").trim().slice(0, 60));
    await page.keyboard.press("Enter");
    const arrived = await page.waitForFunction(([h, t]) => { const hd = document.querySelector("#route h2"); return location.hash === h && !!hd && hd.textContent.trim() === t; }, [target, targetHeading], { timeout: 15000 }).then(() => true, () => false);
    check(focused === label && arrived, `${P.hash}: "${label}" takes keyboard focus and Enter opens ${target}`, `${P.hash}: "${label}" did not open ${target} (focused ${JSON.stringify(focused)}, now at ${await page.evaluate(() => location.hash)})`);
  }
}

/* ---- a redraw of the same screen brings the panel back, once ---- */
await go("#/board", "Board Drill");
await page.waitForSelector("#route [data-roadmap-launch='Board Simulator']");
await page.evaluate(() => { const frame = document.querySelector("#route [data-roadmap-launch='Board Simulator']").parentElement; G.board.render(frame); });
await page.waitForSelector("#route [data-roadmap-launch='Board Simulator']");
let again = await panelInfo("Board Simulator");
check(again.count === 1 && again.isLast, "Board Drill redrawing itself (as its own Readiness and category links do) shows the panel once, still last", "after a Board Drill redraw: " + JSON.stringify(again));

await go("#/prt", "Physical Readiness");
await page.locator("#route button", { hasText: "Run the drill" }).click();
await page.waitForFunction(() => !document.querySelector("#route [data-roadmap-launch]") && !!document.querySelector("#route .rf-timer"));
ok("Physical Readiness: while the drill is running the launch panel is gone with the rest of the Hub");
await page.locator("#route button", { hasText: /^End$/ }).click();
await page.waitForSelector("#route [data-roadmap-launch='Plan the week']");
again = await panelInfo("Plan the week");
const hubFocus = await page.evaluate(() => (document.activeElement && document.activeElement.tagName) || "");
check(again.count === 1 && again.isLast, "Physical Readiness: ending the drill returns to the Hub with the panel back, once, last", "after End: " + JSON.stringify(again));
check(hubFocus === "H2", "and keyboard focus is on the Hub heading, not dropped to the page body", "focus after End is on <" + hubFocus + ">");

/* ---- order, arguments, isolation: through the public API, on the real screens ---- */
const before = noise.length;
const refused = await page.evaluate(() => {
  const want = { "board:rendered": ".segmented", "drills:rendered": ".card-results-grid", "prt:rendered": ".list-detail" };
  window.__extProbe = {};
  // Subscribed AHEAD of the probe below, so the probe only runs if a failing
  // handler really is skipped rather than ending the loop.
  G.ext.on("drills:rendered", function () { throw new Error("planted: this handler throws"); });
  G.ext.on("drills:rendered", function () { return Promise.reject(new Error("planted: this handler rejects")); });
  Object.keys(want).forEach((name) => G.ext.on(name, function (mount) {
    window.__extProbe[name] = {
      isElement: mount instanceof Element, inRoute: !!(mount && mount.closest && mount.closest("#route")), drawn: !!(mount && mount.querySelector(want[name])),
      // Leadership Drills appends its bibliography last, after an awaited read - if it is here, the async render had finished.
      finished: name !== "drills:rendered" || /Bibliography/.test(mount.textContent),
      panelAlreadyThere: !!mount.querySelector("[data-roadmap-launch]"),
    };
  }));
  return { misspelt: G.ext.on("bord:rendered", function () {}), notAFunction: G.ext.on("board:rendered", "not a function"), ranUnknown: G.ext.run("nope:rendered") };
});
check(refused.misspelt === false && refused.notAFunction === false, "G.ext.on refuses a misspelt point name and a handler that is not a function", "on() accepted a bad registration: " + JSON.stringify(refused));
for (const P of PANELS) {
  await go(P.hash, P.heading);
  await page.waitForSelector(`#route [data-roadmap-launch='${P.title}']`);
  await page.waitForFunction((n) => !!(window.__extProbe && window.__extProbe[n]), P.point, { timeout: 15000 }).catch(() => {});
  const r = await page.evaluate((n) => window.__extProbe[n] || null, P.point);
  check(!!r && r.isElement && r.inRoute && r.drawn && r.finished, `${P.point}: a handler is handed the screen's mount element AFTER the screen is drawn${P.point === "drills:rendered" ? " (the async render had finished)" : ""}`, `${P.point}: handler saw ${JSON.stringify(r)}`);
  check(!!r && r.panelAlreadyThere, `${P.point}: handlers run in the order they subscribed (the launch panel was already there)`, `${P.point}: a later handler ran before the module's own`);
}
// Leadership Drills with a throwing handler AND a rejecting handler registered ahead of the others:
await go("#/drills", "Leadership Drills");
await page.waitForSelector("#route [data-roadmap-launch='Collective leader tools']");
const host = await page.evaluate(() => ({ cards: document.querySelectorAll("#route .card-results-grid .panel").length, bib: /Bibliography/.test(document.querySelector("#route").textContent), failed: /Something went wrong/.test(document.querySelector("#route").textContent) }));
check(host.cards > 0 && host.bib && !host.failed, "a handler that throws and one that rejects do not break the host screen: Leadership Drills drew in full, and the launch panel after them still appeared", "host screen after failing handlers: " + JSON.stringify(host));
const provoked = noise.slice(before);
const expectShapes = [/G\.ext: no such extension point, handler ignored \(bord:rendered\)/, /G\.ext: handler is not a function, ignored \(board:rendered\)/, /G\.ext: no such extension point, nothing run \(nope:rendered\)/, /G\.ext: a handler failed \(drills:rendered\).*planted: this handler throws/, /G\.ext: a handler failed \(drills:rendered\).*planted: this handler rejects/];
for (const re of expectShapes) check(provoked.some((l) => re.test(l)), `logged out loud: ${re.source.replace(/\\/g, "").slice(0, 70)}`, `nothing logged matching ${re} - got ${JSON.stringify(provoked.slice(0, 6))}`);
const unexpected = noise.filter((l, i) => i < before || !expectShapes.some((re) => re.test(l)));
check(unexpected.length === 0, "no console errors/warnings or page errors other than the ones this suite provoked on purpose", "console noise: " + unexpected.slice(0, 6).join(" | "));

console.log(fails === 0 ? "\nEXT POINTS: all passed" : `\nEXT POINTS: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
