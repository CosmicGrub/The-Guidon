/**
 * testkit self-test: the shared helpers in tools/testkit.mjs do what their
 * comments promise - checked the way a suite would use them, against the
 * real built app and against purpose-built fixture pages.
 *
 * The helpers exist because of four failure shapes (see testkit.mjs's own
 * header), so each section here first shows the OLD idiom misbehaving on the
 * fixture - a control, so we know the fixture can tell the difference - and
 * then shows the helper getting it right:
 *
 *   - ok / bad / finish / expectNoConsoleNoise: the house output and exit
 *     codes, proven in child processes (finish() exits, so it cannot be
 *     called in-process), including "a suite that asserted nothing fails";
 *   - bootApp / openSession: onboarding really dismissed, rows seeded before
 *     the boot the suite sees, a seeded profile keeps the welcome screen
 *     shut, one browser per process, the standalone build boots the same way;
 *   - liveCount: equals tools/assemble-bank.mjs for every kind and for every
 *     single category (no literal anywhere in this file), differs between
 *     "what this Soldier is served" and "everything the build carries" when
 *     it should, and refuses a misspelt category instead of returning 0;
 *   - waitForRoute: resolves only once the screen is drawn, rebuilds it on
 *     { fresh }, and fails loudly on an unknown screen or a `ready` selector
 *     that never shows; until() polls and hands back a boolean to assert on;
 *   - clickWhenStable: a click that does not wait lands on a button that is
 *     still moving; the helper's lands after it has stopped - and it follows
 *     a node that is replaced mid-wait, waits out disabled / inert, and says
 *     WHY when it gives up.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assembleBank } from "./assemble-bank.mjs";
import {
  bootApp, openSession, ok, bad, check, finish, captureNoise, expectNoConsoleNoise,
  clickWhenStable, waitForRoute, waitForBoot, liveCount, until, PERSONAL_PROFILE, PROFILE_KEY,
} from "./testkit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = pathToFileURL(path.join(HERE, "testkit.mjs")).href;

const throws = async (fn) => { try { await fn(); return null; } catch (e) { return String(e && e.message); } };

/* =====================================================================
   1. Pure node: PASS/FAIL output, exit codes, noise - in child processes.
   ===================================================================== */
{
  const dir = mkdtempSync(path.join(tmpdir(), "guidon-testkit-"));
  const run = (name, body) => {
    const file = path.join(dir, name + ".mjs");
    writeFileSync(file, `import * as kit from ${JSON.stringify(KIT)};\n${body}\n`);
    const r = spawnSync(process.execPath, [file], { encoding: "utf8" });
    return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
  };
  try {
    const green = run("green", `kit.ok("first"); kit.check(1 + 1 === 2, "sums"); await kit.finish("DEMO");`);
    check(green.code === 0 && green.out.includes("  PASS  first\n") && green.out.includes("  PASS  sums\n") && green.out.endsWith("\nDEMO: all passed\n"),
      "an all-green suite prints the house PASS lines, \"<LABEL>: all passed\", and exits 0", () => "green run: " + JSON.stringify(green));

    const red = run("red", `kit.ok("first"); kit.bad("second"); kit.check(false, "third", () => "third went wrong"); await kit.finish("DEMO");`);
    check(red.code === 1 && red.out.includes("  FAIL  second\n") && red.out.includes("  FAIL  third went wrong\n") && red.out.endsWith("\n2 FAILURE(S)\n") && !red.out.includes("all passed"),
      "a failing suite prints the house FAIL lines, \"<n> FAILURE(S)\", and exits 1", () => "red run: " + JSON.stringify(red));

    const empty = run("empty", `await kit.finish("DEMO");`);
    check(empty.code === 1 && /without making a single assertion/.test(empty.out),
      "a suite that finishes without asserting anything fails instead of reading as green", () => "empty run: " + JSON.stringify(empty));

    const noisy = run("noisy", `kit.expectNoConsoleNoise(["error: boom", "warning: favicon.ico 404"], { ignore: [/favicon/] }); await kit.finish("DEMO");`);
    check(noisy.code === 1 && /FAIL {2}1 console message\(s\): error: boom/.test(noisy.out),
      "expectNoConsoleNoise fails on a real message, names it, and leaves the ignored one out", () => "noisy run: " + JSON.stringify(noisy));

    const quiet = run("quiet", `kit.expectNoConsoleNoise(["warning: favicon.ico 404"], { ignore: [/favicon/], pass: "quiet enough" }); await kit.finish("DEMO");`);
    check(quiet.code === 0 && quiet.out.includes("  PASS  quiet enough\n"),
      "expectNoConsoleNoise passes, with the suite's own wording, when only ignored noise remains", () => "quiet run: " + JSON.stringify(quiet));

    const early = run("early", `try { await kit.openSession(); kit.bad("no throw"); } catch (e) { kit.check(/call bootApp\\(\\) first/.test(e.message), "threw", e.message); } await kit.finish("DEMO");`);
    check(early.code === 0, "openSession() before bootApp() is refused with a message saying what to do", () => "early run: " + JSON.stringify(early));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* =====================================================================
   2. bootApp / openSession against the real built app.
   ===================================================================== */
const headless = assembleBank();
const requested = [];
const boot = await bootApp({
  viewport: { width: 1100, height: 800 },
  seedKv: { "testkit:probe": { hello: "from before boot" } },
  beforeLoad: async ({ page, url }) => {
    page.on("request", (r) => requested.push(r.url()));
    await page.addInitScript(() => { window.__testkitInit = typeof window.G; });
    requested.push("beforeLoad saw " + url + " at " + page.url());
  },
});
const { page, noise } = boot;

{
  // (Read FIRST, in the same breath as the handover: the welcome screen's
  // modal keeps the whole app inert for ~400ms after its overlay is gone, and
  // in that window focus() is a silent no-op and keys land on <body>.)
  const state = await page.evaluate(async () => ({
    inert: document.getElementById("app").hasAttribute("inert"),
    focusTook: (() => { const b = document.querySelector(".nav button"); if (!b) return null; b.focus(); const took = document.activeElement === b; b.blur(); return took; })(),
    overlay: !!document.querySelector("#ob-overlay"),
    store: !!(window.G && window.G.store),
    probe: ((await window.G.db.get("kv", "testkit:probe")) || {}).v || null,
    width: window.innerWidth,
  }));
  check(!state.overlay && state.store, "bootApp() returns with the welcome screen dismissed and the app started", () => JSON.stringify(state));
  check(state.inert === false && state.focusTook === true, "and with the app handed back: nothing is still locked behind the closed welcome screen, so a focus() or a key press in the suite's very first step lands where it was aimed", () => JSON.stringify({ inert: state.inert, focusTook: state.focusTook }));
  check(state.probe && state.probe.hello === "from before boot", "seedKv rows are in the app's on-device store by the time the suite gets the page", () => JSON.stringify(state));
  check(state.width === 1100, "the viewport asked for is the viewport the page has", () => "innerWidth " + state.width);
  check(boot.browser && boot.context && boot.server && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(boot.url) && Array.isArray(noise),
    "bootApp() hands back { browser, context, page, server, url, noise }", () => Object.keys(boot).join(","));

  const init = await page.evaluate(() => window.__testkitInit);
  check(requested[0] === "beforeLoad saw " + boot.url + " at about:blank" && requested[1] === boot.url && init === "undefined",
    "beforeLoad() runs before the page navigates: its listener sees the very first request, and its init script runs before any app code", () => JSON.stringify({ first: requested.slice(0, 2), init }));

  const again = await throws(() => bootApp());
  check(again && /ONE browser/.test(again) && /openSession/.test(again), "a second bootApp() in the same suite is refused and points at openSession()", () => String(again));

  // noise capture: provoke one of each kind on purpose, see them land, then
  // clear them so the suite's closing "no noise" check still means something.
  await page.evaluate(() => { console.error("testkit-probe-error"); console.warn("testkit-probe-warning"); console.log("testkit-probe-log"); setTimeout(() => { throw new Error("testkit-probe-throw"); }, 0); });
  await page.waitForFunction(() => new Promise((r) => setTimeout(() => r(true), 50)));
  const got = noise.join(" | ");
  check(noise.includes("error: testkit-probe-error") && noise.includes("warning: testkit-probe-warning") && noise.some((n) => /^pageerror: .*testkit-probe-throw/.test(n)) && !/probe-log/.test(got),
    "noise collects console errors, warnings and uncaught exceptions - and not ordinary logging", () => got);
  noise.length = 0;
}

/* =====================================================================
   3. liveCount reads the running app, and agrees with assemble-bank.
   ===================================================================== */
{
  const H = headless.data;
  const want = headless.finalCounts;
  const got = {
    board: await liveCount(page, { kind: "board" }),
    boardBank: await liveCount(page, { kind: "board", scope: "bank" }),
    scenarios: await liveCount(page, { kind: "scenarios" }),
    doctrineBank: await liveCount(page, { kind: "doctrine", scope: "bank" }),
    doctrine: await liveCount(page, { kind: "doctrine" }),
    categories: await liveCount(page, { kind: "categories" }),
    creedsBank: await liveCount(page, { kind: "creeds", scope: "bank", allowZero: true }),
    recitable: await liveCount(page, { kind: "recitable" }),
  };
  check(got.board === want.board && got.boardBank === want.board, `board cards: the running app and tools/assemble-bank.mjs agree (${got.board})`, () => JSON.stringify({ got, want }));
  check(got.scenarios === want.scenarios, `scenarios agree (${got.scenarios})`, () => JSON.stringify({ got, want }));
  check(got.doctrineBank === want.doctrine, `doctrine entries in the build agree (${got.doctrineBank})`, () => JSON.stringify({ got, want }));

  // "visible" doctrine is what THIS Soldier is served: the app hides entries
  // by confidence unless a setting shows them. Work the same sum out from
  // the headless bank and the page's own settings.
  const s = await page.evaluate(() => { const t = window.G.store.settings(); return { inTransition: !!t.showInTransition, community: !!t.showCommunity, tier: t.tierFilter || "all" }; });
  const served = H.doctrine.entries.filter((d) => !(d.confidence === "in_transition" && !s.inTransition) && !(d.confidence === "community" && !s.community)).length;
  check(s.tier === "all" && got.doctrine === served && got.doctrine <= got.doctrineBank,
    `doctrine this Soldier is served (${got.doctrine} of ${got.doctrineBank}) matches the app's own confidence settings applied to the headless bank`, () => JSON.stringify({ s, served, got }));

  const byCat = new Map();
  for (const q of H.board.questions) byCat.set(q.category, (byCat.get(q.category) || 0) + 1);
  check(got.categories === byCat.size, `distinct board categories agree (${got.categories})`, () => got.categories + " vs " + byCat.size);
  const wrong = [];
  for (const [category, n] of byCat) { const live = await liveCount(page, { category }); if (live !== n) wrong.push({ category, live, headless: n }); }
  check(wrong.length === 0, `every one of the ${byCat.size} categories has the same size in the running app as in the headless bank`, () => JSON.stringify(wrong.slice(0, 5)));
  const recitable = H.board.questions.filter((q) => q.category === "Creeds" && Array.isArray(q.lines) && q.lines.length > 0).length;
  check(got.recitable === recitable && got.creedsBank === (H.creeds || []).length, `recitable texts (${got.recitable}) and creeds (${got.creedsBank}) agree too`, () => JSON.stringify({ got, recitable }));

  // a misspelt category must not come back as a quiet 0
  const realCategory = [...byCat.keys()].find((c) => c.length > 8);
  const typo = realCategory.slice(0, -1) + "~";
  const miss = await throws(() => liveCount(page, { category: typo }));
  check(miss && miss.includes(JSON.stringify(typo)) && miss.includes(JSON.stringify(realCategory)),
    "a misspelt category throws and suggests the real one, instead of returning 0", () => String(miss));
  check((await liveCount(page, { category: typo, allowZero: true })) === 0, "{ allowZero: true } is the explicit way to accept an empty answer");
  const badKind = await throws(() => liveCount(page, { kind: "cards" }));
  check(badKind && /kind must be one of/.test(badKind), "an unknown kind is refused by name", () => String(badKind));
}

/* =====================================================================
   4. waitForRoute
   ===================================================================== */
{
  await waitForRoute(page, "#/home");
  // Control: the old idiom's first half. Setting the hash does not draw the
  // screen - the router runs later - which is why suites slept after it.
  const before = await page.evaluate(() => { location.hash = "#/recite"; return { title: document.title, add: !!document.querySelector("[data-recite-add]") }; });
  check(/Home/.test(before.title) && !before.add, "control: right after location.hash is set the OLD screen is still up - a suite must wait for something", () => JSON.stringify(before));
  await waitForRoute(page, "#/recite", { ready: "[data-recite-add]" });
  const after = await page.evaluate(() => ({ hash: location.hash, title: document.title, add: !!document.querySelector("[data-recite-add]"), label: (window.G.routes.find((r) => r.hash === "#/recite") || {}).label }));
  check(after.hash === "#/recite" && after.title === "GUIDON - " + after.label && after.add,
    "waitForRoute() resolves with the screen drawn: the hash, the router's own title, and the control the suite asked for", () => JSON.stringify(after));

  await page.evaluate(() => { document.querySelector("[data-recite-add]").setAttribute("data-testkit-mark", "old"); });
  await waitForRoute(page, "#/recite", { ready: "[data-recite-add]" });
  const kept = await page.evaluate(() => !!document.querySelector("[data-testkit-mark]"));
  await waitForRoute(page, "#/recite", { ready: "[data-recite-add]", fresh: true });
  const rebuilt = await page.evaluate(() => ({ mark: !!document.querySelector("[data-testkit-mark]"), add: !!document.querySelector("[data-recite-add]"), hash: location.hash }));
  check(kept && !rebuilt.mark && rebuilt.add && rebuilt.hash === "#/recite",
    "asking for the screen the page is already on changes nothing; { fresh: true } rebuilds it from scratch", () => JSON.stringify({ kept, rebuilt }));

  const deep = await throws(() => waitForRoute(page, "#/board?category=x"));
  check(deep === null && (await page.evaluate(() => location.hash)) === "#/board?category=x", "a deep link (parameters after the route) is a known screen", () => String(deep));

  const unknown = await throws(() => waitForRoute(page, "#/no-such-screen", { timeout: 1500 }));
  check(unknown && /no screen at #\/no-such-screen/.test(unknown) && /On screen: \{/.test(unknown), "an unknown screen is refused at once, and the error says what was on screen", () => String(unknown));
  const t0 = Date.now();
  const never = await throws(() => waitForRoute(page, "#/home", { ready: "#testkit-never-rendered", timeout: 900 }));
  check(never && never.includes("#testkit-never-rendered") && /never became visible within 900ms/.test(never) && /"hash":"#\/home"/.test(never) && Date.now() - t0 < 5000,
    "a `ready` control that never shows fails in the time allowed, naming the selector and the screen - nothing is swallowed", () => String(never));
  const shape = await throws(() => waitForRoute(page, "board"));
  check(shape && /must look like/.test(shape), "a hash without #/ is refused before it can time out", () => String(shape));

  // A router that names the new screen at once but swaps it in LATER - what
  // the app's page-to-page cross-fade does (the browser calls the swap back
  // a frame after route() has already set the title). Here the delay is
  // 300ms so no runner is fast enough to hide it. Both screens have a
  // heading and a button, so the title, "#route has content" and a shared
  // `ready` selector are all satisfied by the OLD screen the whole time.
  {
    const rt = await boot.context.newPage();
    captureNoise(rt, { into: noise, tag: "[router fixture]" });
    await rt.setContent(`<!doctype html><meta charset="utf-8"><title>GUIDON</title>
<div id="route"><div class="empty">Loading GUIDON...</div></div>
<script>
  window.G = { routes: [{ hash: "#/one", label: "One" }, { hash: "#/two", label: "Two" }] };
  window.__swaps = 0;
  window.addEventListener("hashchange", function () {
    var r = window.G.routes.find(function (x) { return x.hash === location.hash; });
    document.title = "GUIDON - " + r.label;
    setTimeout(function () {
      document.getElementById("route").innerHTML = "<div><h2>" + r.label + "</h2><button>Open</button></div>";
      window.__swaps++;
    }, 300);
  });
  location.hash = "#/one";
</script>`);
    await rt.waitForFunction(() => window.__swaps === 1);
    await waitForRoute(rt, "#/two", { ready: "#route h2" });
    const landed = await rt.evaluate(() => ({ heading: document.querySelector("#route h2").textContent, swaps: window.__swaps, title: document.title }));
    check(landed.heading === "Two" && landed.swaps === 2,
      "waitForRoute() does not return while #route still holds the screen it is leaving, even though the title and a shared `ready` selector already match (the cross-fade case)", () => JSON.stringify(landed));
    await waitForRoute(rt, "#/two", { ready: "#route h2" });
    check((await rt.evaluate(() => window.__swaps)) === 2, "and asking again for the screen it is already on still returns at once, without waiting for a swap that is not coming");
    await rt.close();
  }

  // until(): poll, then assert - true when the state arrives, false (not a
  // throw, not a swallowed rejection) when it does not, and a real error
  // (the predicate itself blowing up) still surfaces.
  // (read in the same breath as the timer is set, so a slow runner cannot make "early" late)
  const early = await page.evaluate(() => { window.__late = false; setTimeout(() => { window.__late = true; }, 250); return window.__late; });
  const arrived = await until(page, () => window.__late === true);
  const u0 = Date.now();
  const gaveUp = await until(page, () => window.__neverSet === true, null, { timeout: 500 });
  const broke = await throws(() => until(page, () => { throw new Error("predicate blew up"); }, null, { timeout: 500 }));
  // The browser reports that deliberate throw as an uncaught page error too;
  // take exactly that one back out so the closing noise check stays honest.
  for (let i = noise.length - 1; i >= 0; i--) if (/predicate blew up/.test(noise[i])) noise.splice(i, 1);
  check(early === false && arrived === true && gaveUp === false && Date.now() - u0 < 4000 && broke && /predicate blew up/.test(broke),
    "until() is true once the state arrives, false when time runs out, and still throws a real error", () => JSON.stringify({ early, arrived, gaveUp, broke }));
}

/* =====================================================================
   5. clickWhenStable, on a fixture page in the same browser.
   ===================================================================== */
{
  const fx = await boot.context.newPage();
  captureNoise(fx, { into: noise, tag: "[fixture]" });
  await fx.setContent(`<!doctype html><meta charset="utf-8"><title>testkit fixture</title>
<style>
  body { margin: 0; font: 16px sans-serif; }
  button { position: absolute; padding: 8px 12px; }
  #mover { left: 0; top: 20px; }
  #spinner { left: 0; top: 80px; animation: slide 0.4s linear infinite alternate; }
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(200px); } }
  #slot { position: absolute; left: 0; top: 140px; width: 300px; height: 40px; }
  #slot button, #region button, #twins button { position: static; }
  #region { position: absolute; left: 0; top: 200px; }
  #twins { position: absolute; left: 0; top: 260px; }
</style>
<button id="mover">Mover</button>
<button id="spinner">Never still</button>
<div id="slot"></div>
<div id="region" inert><button id="behind">Behind a dialog</button></div>
<div id="twins"><button class="twin">Twin</button><button class="twin">Twin</button></div>
<script>
  window.__clicks = [];
  window.__moving = false;
  var mover = document.getElementById("mover");
  mover.addEventListener("click", function () { window.__clicks.push({ id: "mover", moving: window.__moving, left: mover.style.left }); });
  // Moves for ms milliseconds, one step per painted frame - what a sliding panel or a
  // list settling after a redraw does to the button inside it.
  window.startMove = function (ms) {
    var t0 = performance.now(); window.__moving = true; mover.style.left = "0px";
    (function step() { var t = performance.now() - t0; mover.style.left = Math.min(300, Math.round(t / ms * 300)) + "px"; if (t < ms) requestAnimationFrame(step); else window.__moving = false; })();
  };
  // A view that shows a busy button, then REDRAWS: the node is replaced by a
  // new one that looks the same to a selector.
  window.startRedraw = function (ms) {
    var slot = document.getElementById("slot");
    slot.innerHTML = '<button id="save" aria-disabled="true">Save</button>';
    slot.firstChild.addEventListener("click", function () { window.__clicks.push({ id: "save", node: "old" }); });
    setTimeout(function () {
      slot.innerHTML = '<button id="save">Save</button>';
      slot.firstChild.addEventListener("click", function () { window.__clicks.push({ id: "save", node: "new" }); });
    }, ms);
  };
  document.getElementById("behind").addEventListener("click", function () { window.__clicks.push({ id: "behind", inert: !!document.querySelector("#region[inert]") }); });
</script>`);
  const clicks = (id) => fx.evaluate((i) => window.__clicks.filter((c) => c.id === i), id);

  // Control: a click that does not wait lands mid-move.
  // (started and clicked in one synchronous step, so no runner is slow enough to change the answer)
  await fx.evaluate(() => { window.startMove(300); document.getElementById("mover").click(); });
  let c = await clicks("mover");
  check(c.length === 1 && c[0].moving === true, "control: a click that does not wait lands while the button is still moving (the fixture can tell)", () => JSON.stringify(c));
  await fx.waitForFunction(() => window.__moving === false);

  // { force: true } switches Playwright's OWN actionability checks off, so
  // the only thing left that can make this click wait is the helper itself.
  await fx.evaluate(() => { window.startMove(300); });
  const t0 = Date.now();
  const res = await clickWhenStable(fx, "#mover", { click: { force: true } });
  const took = Date.now() - t0;
  c = await clicks("mover");
  check(c.length === 2 && c[1].moving === false && c[1].left === "300px",
    `clickWhenStable() waits out a button that moves for 300ms and clicks it where it came to rest (took ${took}ms) - its own wait, with Playwright's switched off`, () => JSON.stringify({ c, took, res }));

  // It takes a locator as well as a selector.
  await fx.evaluate(() => { window.startMove(200); });
  await clickWhenStable(fx, fx.locator("button", { hasText: /^Mover$/ }));
  c = await clicks("mover");
  check(c.length === 3 && c[2].moving === false, "it accepts a Playwright locator as well as a selector string", () => JSON.stringify(c));

  // The node is replaced while we wait.
  await fx.evaluate(() => { window.startRedraw(350); });
  const redraw = await clickWhenStable(fx, "#save");
  c = await clicks("save");
  check(c.length === 1 && c[0].node === "new" && redraw.rounds >= 1,
    "when the view redraws mid-wait it follows the selector to the NEW button - the busy one it started on is never clicked", () => JSON.stringify({ c, redraw }));

  // inert: waits it out, and says so when it cannot.
  const stuck = await throws(() => clickWhenStable(fx, "#behind", { timeout: 700 }));
  check(stuck && /inert region \(a dialog is open over it\)/.test(stuck) && /not clickable within 700ms/.test(stuck) && (await clicks("behind")).length === 0,
    "a button under an open dialog is never clicked, and the error says that is why", () => String(stuck));
  await fx.evaluate(() => { setTimeout(() => document.getElementById("region").removeAttribute("inert"), 300); });
  await clickWhenStable(fx, "#behind");
  c = await clicks("behind");
  check(c.length === 1 && c[0].inert === false, "once the dialog is gone the same call goes through", () => JSON.stringify(c));

  const spinning = await throws(() => clickWhenStable(fx, "#spinner", { timeout: 700 }));
  check(spinning && /still moving/.test(spinning), "a button that never stops moving is reported as \"still moving\", not as a bare timeout", () => String(spinning));
  const missing = await throws(() => clickWhenStable(fx, "#not-on-the-page", { timeout: 600 }));
  check(missing && /never attached to the page/.test(missing), "a selector that matches nothing is reported as never attached", () => String(missing));
  const twins = await throws(() => clickWhenStable(fx, ".twin", { timeout: 600 }));
  check(twins && /more than one element/.test(twins), "a selector that matches two elements is a bug in the suite, and is reported as one", () => String(twins));
  await fx.close();
}

/* =====================================================================
   6. A seeded profile, and the standalone build, in the SAME browser.
   ===================================================================== */
{
  const soldier = await openSession({ profile: { ...PERSONAL_PROFILE, mos: "11B" }, noise, noiseTag: "[profile]" });
  const who = await soldier.page.evaluate(async (k) => ({
    overlay: !!document.querySelector("#ob-overlay"),
    row: ((await window.G.db.get("kv", k)) || {}).v || null,
    tier: window.G.store.settings().tierFilter || "all",
  }), PROFILE_KEY);
  check(!who.overlay && who.row && who.row.displayName === PERSONAL_PROFILE.displayName && who.row.mos === "11B",
    "a seeded profile boots straight into the app - the welcome screen never opens, and nobody clicked Guest", () => JSON.stringify(who));
  // Cards written for another MOS are kept out of this Soldier's pool, so
  // "visible" and "bank" must now differ by exactly those cards.
  const others = headless.data.board.questions.filter((q) => Array.isArray(q.mos) && q.mos.length && !q.mos.some((m) => "11B".indexOf(String(m).toUpperCase()) === 0)).length;
  const visible = await liveCount(soldier.page, { kind: "board" });
  const bank = await liveCount(soldier.page, { kind: "board", scope: "bank" });
  if (who.tier === "all") {
    check(others > 0 && bank === headless.finalCounts.board && visible === bank - others,
      `liveCount follows the Soldier: an 11B is served ${visible} of the ${bank} cards (the ${others} written for another MOS stay out)`, () => JSON.stringify({ visible, bank, others }));
  } else {
    check(bank === headless.finalCounts.board && visible < bank, `liveCount follows the Soldier: ${visible} of ${bank} cards at rank filter ${who.tier}`, () => JSON.stringify({ visible, bank, who }));
  }
  await soldier.context.close();

  // The other card on the welcome screen. Same contract as Guest: past the
  // welcome screen, app handed back, and the Soldier the suite asked for.
  const kiosk = await openSession({ profile: "kiosk", viewport: { width: 344, height: 800 }, noise, noiseTag: "[kiosk]" });
  const k = await kiosk.page.evaluate(() => ({
    inert: document.getElementById("app").hasAttribute("inert"),
    overlay: !!document.querySelector("#ob-overlay"),
    mode: ((window.G.profile && window.G.profile.cached && window.G.profile.cached()) || {}).mode || null,
    sideways: document.documentElement.scrollWidth - window.innerWidth,
  }));
  check(!k.overlay && k.inert === false && k.mode === "kiosk" && k.sideways <= 0,
    "profile: \"kiosk\" picks the Kiosk card: past the welcome screen, app handed back, running as a kiosk - at the narrowest supported width", () => JSON.stringify(k));
  await kiosk.context.close();

  const single = await openSession({ dir: "dist", noise, noiseTag: "[standalone]" });
  await waitForBoot(single.page);
  const sBank = await liveCount(single.page, { kind: "board", scope: "bank" });
  const sFork = await single.page.evaluate(() => window.GUIDON_FORK || null);
  check(/guidon-standalone\.html$/.test(single.url) && sFork === "standalone" && sBank === headless.finalCounts.board,
    `openSession({ dir: "dist" }) boots the standalone single file the same way, and it carries the same ${sBank} cards`, () => JSON.stringify({ url: single.url, sFork, sBank }));
  await single.context.close();
}

expectNoConsoleNoise(noise, { pass: "no console errors or warnings from the app or the fixture, beyond the ones provoked on purpose" });
await finish("TESTKIT");
