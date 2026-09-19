/**
 * testkit: the shared plumbing every tools/test-*.mjs suite used to retype.
 *
 * Why this exists (audit 2026-09, recommendation C / R38): ~200 suites each
 * re-implement the same five things - start the static server, launch a
 * browser, get past onboarding, count PASS/FAIL, collect console noise - and
 * nearly every CI flake this project has chased has one of three signatures
 * that a shared helper can simply not have:
 *
 *   1. a click racing a redraw          -> clickWhenStable()
 *   2. a fixed sleep standing in for    -> waitForRoute() with a `ready`
 *      "the view has rendered"             control, and until() for the rest
 *   3. a wait whose failure was          -> every helper here THROWS, naming
 *      swallowed by .catch(() => {})        the step and what was on screen
 *
 * and a fourth that is not a flake but broke three suites in one week: a
 * hard-coded deck size ("17 AFT cards") that a content change made wrong
 *                                         -> liveCount() reads the RUNNING app.
 *
 * tools/lint-test-hygiene.mjs ratchets the old idioms down; tools/new-suite.mjs
 * writes new suites on top of this file so they start without them.
 *
 * House rules this file keeps for you:
 *   - ONE browser per suite (lint-ci-matrix rule (c)): bootApp() refuses a
 *     second call; open further pages with boot.openSession().
 *   - onboarding is dismissed by ./dismiss-onboarding.mjs, never by a local
 *     copy (lint-patterns rule (e)).
 *   - PASS/FAIL lines, "<n> FAILURE(S)" / "<LABEL>: all passed", exit 0/1 -
 *     byte-for-byte what the suites already print.
 *
 * No dependencies beyond playwright, which is imported lazily so a pure-node
 * suite can use ok()/bad()/finish() without paying for it.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./server.mjs";
import { dismissOnboarding, BOOT_DECIDED_JS } from "./dismiss-onboarding.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");

/* "waitForFunction needs more patience, not a new fix" - the recurring
   lesson of the CI-stabilisation rounds: a 2-vCPU runner under 4-way
   Chromium contention takes many times longer than a laptop to reach the
   same state. One generous default here instead of a per-suite number that
   gets bumped 300ms -> 5s -> 15s -> 30s across three flake hunts. A wait
   that is going to succeed returns the moment it can, so patience costs
   nothing on the happy path. */
export const PATIENCE_MS = 15000;

export const PROFILE_KEY = "guidon:profile:v1";
/* The completed-profile fixture a couple of dozen suites hand-type before a
   reload so onboarding never opens (a real Soldier auditing a screen has
   already finished setup). Spread it and override what your suite cares
   about: bootApp({ profile: { ...PERSONAL_PROFILE, mos: "92A" } }). */
export const PERSONAL_PROFILE = Object.freeze({
  onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
  displayName: "SGT TESTKIT", lastName: "TESTKIT", anonymous: false,
  studyWeakPoints: [], readinessConcerns: [], actionPlan: [], promoPoints: {},
});

/* ---------------------------------------------------------------------
   PASS / FAIL bookkeeping
   --------------------------------------------------------------------- */
let fails = 0;
let passes = 0;
export const ok = (m) => { passes++; console.log("  PASS  " + m); };
export const bad = (m) => { fails++; console.log("  FAIL  " + m); };
/** cond ? ok(pass) : bad(fail). `fail` may be a function so an expensive
 *  diagnostic (JSON.stringify of a page read) is only built when needed. */
export const check = (cond, pass, fail) => {
  if (cond) ok(pass);
  else bad(typeof fail === "function" ? fail() : (fail == null ? "NOT: " + pass : fail));
  return !!cond;
};
export const failures = () => fails;

let active = null; // the one boot this process is allowed

/**
 * finish(label): close whatever bootApp() opened, print the house summary
 * line and exit 0/1. A suite that asserted NOTHING is a failure - an early
 * `return`, a skipped block or a typo'd guard otherwise reads as green.
 */
export async function finish(label = "SUITE") {
  await closeActive();
  if (!fails && !passes) { fails++; console.log("  FAIL  the suite finished without making a single assertion"); }
  console.log(fails ? `\n${fails} FAILURE(S)` : `\n${label}: all passed`);
  process.exit(fails ? 1 : 0);
}

async function closeActive() {
  const a = active;
  if (!a || a.closed) return;
  a.closed = true;
  try { await a.browser.close(); } catch (e) { /* already gone - nothing left to release */ }
  for (const s of a.servers.values()) { try { s.server.close(); } catch (e) { /* already closed */ } }
}

/* ---------------------------------------------------------------------
   console noise
   --------------------------------------------------------------------- */
/**
 * captureNoise(page, { levels, tag, into }) -> the array being filled.
 * Same lines the suites already collect: "<type>: <text>" for console
 * messages at `levels`, "pageerror: <message>" for uncaught exceptions.
 */
export function captureNoise(page, { levels = ["error", "warning"], tag = "", into = [] } = {}) {
  const t = tag ? tag + " " : "";
  page.on("console", (m) => { if (levels.includes(m.type())) into.push(t + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => into.push(t + "pageerror: " + e.message));
  return into;
}

/**
 * expectNoConsoleNoise(noise, { ignore, pass }) - one PASS or one FAIL line.
 * `ignore` is a list of RegExps for noise a suite provokes ON PURPOSE (a
 * blocked request it is testing, a favicon 404 from a fixture page); an
 * ignore that swallows everything is a smell, so keep each one narrow.
 */
export function expectNoConsoleNoise(noise, { ignore = [], pass = "no console errors or warnings" } = {}) {
  if (!Array.isArray(noise)) throw new Error("expectNoConsoleNoise: pass the `noise` array bootApp() returned");
  const real = noise.filter((n) => !ignore.some((re) => re.test(n)));
  return check(real.length === 0, pass, () => real.length + " console message(s): " + real.slice(0, 5).join(" | "));
}

/* ---------------------------------------------------------------------
   boot
   --------------------------------------------------------------------- */
const DEFAULT_ENTRY = { dist: "guidon-standalone.html" };

/**
 * bootApp({ dir = "web", viewport, profile = "guest", seedKv, ... })
 *   -> { browser, context, page, server, url, noise, openSession, close }
 * (everything openSession() takes, plus launchOptions)
 *
 * Serves the BUILT app (`dir` is relative to guidon-app/, so the suite works
 * from any cwd), launches the suite's one browser, opens a page, optionally
 * writes rows into the app's own on-device store BEFORE the boot that the
 * suite sees, and gets past onboarding:
 *
 *   profile: "guest" (default) | "kiosk"  pick that card on the welcome
 *                                         screen, via ./dismiss-onboarding.mjs
 *   profile: { ...PERSONAL_PROFILE }      seed a finished profile, reload,
 *                                         and PROVE onboarding stayed shut
 *   profile: null                         leave the welcome screen up (a
 *                                         suite that tests onboarding itself)
 *   seedKv:  { key: value } | [{ k, v }]  rows for the "kv" store
 *
 * Other options: entry (file inside dir; dist/ defaults to the standalone
 * file), noiseLevels, noiseTag, contextOptions, launchOptions, and
 * beforeLoad({ page, context, url }) - called after the page exists and
 * BEFORE it navigates, for a request listener that must not miss the first
 * request, an addInitScript, or a CDP session.
 */
export async function bootApp(opts = {}) {
  if (active) {
    throw new Error("testkit.bootApp(): already called once in this process. A suite may launch at most ONE browser " +
      "(lint-ci-matrix rule (c)) - open another page or viewport with boot.openSession({ ... }) instead.");
  }
  const { launchOptions = {}, ...sessionOpts } = opts;
  builtEntry(sessionOpts.dir, sessionOpts.entry); // fail before launching anything if the build is missing
  const { chromium } = await import("playwright");
  active = { browser: await chromium.launch(launchOptions), servers: new Map(), closed: false };
  try {
    const first = await openSession(sessionOpts);
    return Object.assign({ browser: active.browser, openSession, close: closeActive }, first);
  } catch (e) {
    await closeActive();
    throw e;
  }
}

function builtEntry(dir = "web", entry) {
  const file = entry != null ? entry : (DEFAULT_ENTRY[dir] || "");
  const root = path.isAbsolute(dir) ? dir : path.join(APP, dir);
  if (!existsSync(path.join(root, file || "index.html"))) {
    throw new Error(`testkit: ${path.join(root, file || "index.html")} does not exist - build first (npm run icons && npm run build).`);
  }
  return { root, file };
}

/* One static server per built folder, started on first use. Servers are
   cheap; it is BROWSERS the one-per-suite rule rations. */
async function serverFor(dir, entry) {
  const { root, file } = builtEntry(dir, entry);
  if (!active.servers.has(root)) active.servers.set(root, await serve(root));
  const s = active.servers.get(root);
  return { server: s.server, url: s.url + file };
}

/**
 * boot.openSession({ dir, viewport, profile, seedKv, noise, ... }) ->
 * { context, page, server, url, noise }. A fresh browser CONTEXT (its own
 * storage) in the SAME browser, booted exactly like the first one. This is
 * how a suite checks a second viewport, a second profile or the other build
 * (dir: "dist" is the standalone single file) without breaking the
 * one-browser rule. Pass `noise: boot.noise` to keep collecting into the
 * one array.
 */
export async function openSession({ dir = "web", entry, viewport, profile = "guest", seedKv = null, noise, noiseLevels = ["error", "warning"], noiseTag = "", contextOptions = {}, beforeLoad = null } = {}) {
  if (!active || active.closed) throw new Error("testkit.openSession(): call bootApp() first");
  const { server, url } = await serverFor(dir, entry);
  const context = await active.browser.newContext(Object.assign({}, viewport ? { viewport } : {}, contextOptions));
  const page = await context.newPage();
  const into = captureNoise(page, { levels: noiseLevels, tag: noiseTag, into: noise || [] });
  // The suite's chance to listen from the very first request, add an init
  // script, or open a CDP session - before anything has loaded.
  if (beforeLoad) await beforeLoad({ page, context, url });
  await page.goto(url, { waitUntil: "load" });

  const rows = kvRows(seedKv);
  const seededProfile = profile && typeof profile === "object";
  if (seededProfile) rows.push({ k: PROFILE_KEY, v: profile });
  if (rows.length) {
    // G.db opens the database lazily on first use, so it is safe to write as
    // soon as the object exists; the reload below is what makes the app's
    // OWN boot read these rows the way it would read a returning Soldier's.
    await page.waitForFunction(() => !!(window.G && window.G.db && typeof window.G.db.put === "function"), null, { timeout: PATIENCE_MS });
    await page.evaluate(async (list) => { for (const r of list) await window.G.db.put("kv", r); }, rows);
    await page.reload({ waitUntil: "load" });
  }

  if (seededProfile) {
    // Never call dismissOnboarding() here: if the seed did not take, it would
    // quietly click "Guest Session" and the suite would run as the wrong
    // Soldier. Wait for the app's real boot decision, then insist.
    await waitForBoot(page);
    if (await page.locator("#ob-overlay").count()) {
      throw new Error("testkit: a finished profile was seeded but the welcome screen still opened - the profile row was not accepted: " + JSON.stringify(profile).slice(0, 300));
    }
  } else if (profile) {
    await dismissOnboarding(page, { mode: profile });
  }
  return { context, page, server, url, noise: into };
}

function kvRows(seedKv) {
  if (!seedKv) return [];
  if (Array.isArray(seedKv)) {
    for (const r of seedKv) if (!r || typeof r.k !== "string") throw new Error("testkit: seedKv rows must look like { k: \"key\", v: value }");
    return seedKv.slice();
  }
  return Object.keys(seedKv).map((k) => ({ k, v: seedKv[k] }));
}

/**
 * waitForBoot(page): resolves once the app has finished its own start-up
 * read (the same signal dismiss-onboarding.mjs trusts) AND a frame has been
 * painted after it, so a welcome screen that is going to open has opened.
 */
export async function waitForBoot(page, { timeout = PATIENCE_MS } = {}) {
  try {
    await page.waitForFunction(() => !!(document.getElementById("route") && window.G && window.G.store), null, { timeout });
    await page.waitForFunction(BOOT_DECIDED_JS, null, { timeout });
  } catch (e) {
    throw new Error("testkit.waitForBoot: the app never finished starting within " + timeout + "ms. " + (await onScreen(page)));
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/* What was actually on screen - appended to every thrown error, because
   "Timeout 15000ms exceeded" alone has cost this project whole evenings. */
async function onScreen(page) {
  try {
    const s = await page.evaluate(() => ({
      hash: location.hash,
      title: document.title,
      overlay: !!document.querySelector("#ob-overlay"),
      dialog: !!document.querySelector(".gm-box, [role=dialog]"),
      route: ((document.getElementById("route") || {}).innerText || "").replace(/\s+/g, " ").slice(0, 160),
    }));
    return "On screen: " + JSON.stringify(s);
  } catch (e) {
    return "On screen: (could not read the page: " + String(e && e.message).split("\n")[0] + ")";
  }
}

/* ---------------------------------------------------------------------
   waitForRoute
   --------------------------------------------------------------------- */
/**
 * waitForRoute(page, "#/recite", { ready: "[data-recite-add]" })
 *
 * Goes to `hash` (unless the page is already there) and resolves only when
 * the app's router has really drawn that screen - the replacement for
 *   location.hash = "#/x"; await page.waitForTimeout(600);
 * Proof of "drawn", all read from the running app, none of it a sleep:
 *   - location.hash is the route (deep-link parameters after it are fine);
 *   - the tab title is that route's own label, which route() sets as its
 *     first act, so the router ran FOR THIS hash;
 *   - the start-up placeholder is gone and #route holds rendered content;
 *   - `ready` (a selector or a locator, optional but recommended) is visible - the one
 *     thing YOUR suite is about to touch. Views load their data
 *     asynchronously, so only the suite knows what "ready" means for it;
 *   - then one painted frame.
 *
 * { fresh: true } first leaves for another screen so the view is rebuilt
 * from scratch even when the page is already on `hash`.
 * Throws, naming what was on screen, if any of that does not happen.
 */
export async function waitForRoute(page, hash, { ready = null, fresh = false, timeout = PATIENCE_MS } = {}) {
  if (typeof hash !== "string" || hash.indexOf("#/") !== 0) throw new Error("waitForRoute: hash must look like \"#/board\", got " + JSON.stringify(hash));
  const known = await page.evaluate((h) => {
    const routes = (window.G && window.G.routes) || [];
    const r = routes.find((x) => x.hash === h) || routes.find((x) => h.indexOf(x.hash) === 0);
    return r ? { hash: r.hash, label: r.label || "" } : null;
  }, hash);
  // An unknown hash is not "slow": the router would silently show Home
  // instead, and a wait could only time out with a misleading message.
  if (!known) throw new Error("waitForRoute: the app has no screen at " + hash + " (not in G.routes). " + (await onScreen(page)));

  if (fresh) {
    const away = known.hash === "#/home" ? "#/settings" : "#/home";
    await page.evaluate((h) => { location.hash = h; }, away);
    await drawn(page, away, null, timeout, "leaving for " + away + " first (fresh: true)");
  }
  await page.evaluate((h) => { if (location.hash !== h) location.hash = h; }, hash);
  await drawn(page, hash, known.label, timeout, "opening " + hash);
  if (ready) {
    const loc = typeof ready === "string" ? page.locator(ready) : ready;
    try { await loc.first().waitFor({ state: "visible", timeout }); }
    catch (e) { throw new Error("waitForRoute: " + hash + " opened, but " + (typeof ready === "string" ? JSON.stringify(ready) : String(ready)) + " never became visible within " + timeout + "ms. " + (await onScreen(page))); }
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function drawn(page, hash, label, timeout, step) {
  try {
    await page.waitForFunction(({ h, label }) => {
      if ((location.hash || "").indexOf(h) !== 0) return false;
      if (label != null && document.title !== (label ? "GUIDON - " + label : "GUIDON")) return false;
      const r = document.getElementById("route");
      if (!r || /Loading GUIDON/.test(r.textContent || "")) return false;
      const frame = r.firstElementChild;
      return !!(frame && frame.childElementCount > 0);
    }, { h: hash, label }, { timeout });
  } catch (e) {
    throw new Error("waitForRoute: " + step + " - the screen was not drawn within " + timeout + "ms. " + (await onScreen(page)));
  }
}

/* ---------------------------------------------------------------------
   until
   --------------------------------------------------------------------- */
/**
 * until(page, fn, arg, { timeout }) -> true as soon as `fn` (run in the
 * page, like waitForFunction) returns something truthy, false if `timeout`
 * passes first.
 *
 * The replacement for BOTH old idioms that sit in front of an assertion:
 *   await page.waitForTimeout(500);                          // hope it is done
 *   await page.waitForFunction(...).catch(() => {});         // hide that it is not
 * Poll for the state, then make the SAME assertion you always made: if the
 * state never arrives the assertion prints its own FAIL line with its own
 * diagnostics, exactly as before - nothing is swallowed, because the wait
 * was never the assertion. Anything other than running out of time (the
 * page closed, `fn` itself threw) is still thrown.
 */
export async function until(page, fn, arg, { timeout = PATIENCE_MS } = {}) {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; }
  catch (e) {
    if (e && (e.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(String(e.message)))) return false;
    throw e;
  }
}

/* ---------------------------------------------------------------------
   clickWhenStable
   --------------------------------------------------------------------- */
/**
 * clickWhenStable(page, locatorOrSelector, { timeout, frames, click })
 *
 * The fix for the click-race signature. Waits until the target is attached,
 * visible, enabled and its box has not moved for `frames` animation frames
 * in a row (default 2), THEN hands over to Playwright's own trusted click
 * (which repeats its actionability checks, including hit-testing).
 *
 * What it adds over a bare locator.click():
 *   - it notices the node being REPLACED while it waits (a view that redraws
 *     after an on-device write swaps the button for a new one) and starts
 *     over on the new node instead of clicking where the old one was;
 *   - "enabled" means what it means to a Soldier: not disabled, not
 *     aria-disabled, not inside a disabled fieldset and not under an `inert`
 *     region (an open dialog makes the whole app inert - Playwright reports
 *     that as "<body> intercepts pointer events" after a full timeout);
 *   - when it gives up it says WHY (detached / hidden / disabled / still
 *     moving) and what was on screen, instead of a bare timeout.
 *
 * It does not, and cannot, know that the app has finished reacting to the
 * PREVIOUS action - wait for that state first (waitForRoute's `ready`, or
 * page.waitForFunction on the thing that changes).
 */
export async function clickWhenStable(page, target, { timeout = PATIENCE_MS, frames = 2, click = {} } = {}) {
  const locator = typeof target === "string" ? page.locator(target) : target;
  if (!locator || typeof locator.click !== "function") throw new Error("clickWhenStable: pass a selector string or a Playwright locator");
  const name = typeof target === "string" ? JSON.stringify(target) : String(locator);
  const deadline = Date.now() + timeout;
  let last = "it was never found";
  let rounds = 0;
  while (Date.now() < deadline) {
    rounds++;
    const left = Math.max(1, deadline - Date.now());
    let state;
    try {
      state = await locator.evaluate(STABILITY_PROBE, { frames, budget: Math.min(left, 1500) }, { timeout: left });
    } catch (e) {
      const msg = String(e && e.message).split("\n")[0];
      // More than one match is a bug in the suite, not something to wait out.
      if (/strict mode violation/i.test(msg)) throw new Error("clickWhenStable: " + name + " matches more than one element - narrow it (" + msg + ")");
      last = /Timeout/i.test(msg) ? "it was never attached to the page" : msg;
      continue; // a node detached mid-probe rejects the evaluate; look again
    }
    if (state.ok) {
      await locator.click(Object.assign({ timeout: Math.max(1000, deadline - Date.now()) }, click));
      return { rounds, box: state.box };
    }
    last = state.why;
  }
  throw new Error("clickWhenStable: " + name + " was not clickable within " + timeout + "ms - " + last + ". " + (await onScreen(page)));
}

/* Runs IN THE PAGE against the resolved element. One probe lasts at most
   `budget` ms so the outer loop can re-resolve the locator: a redraw that
   replaces the node would otherwise leave us watching a detached element. */
const STABILITY_PROBE = (el, { frames, budget }) => new Promise((resolve) => {
  const t0 = performance.now();
  let prev = null, still = 0, why = "it was never measured";
  // rAF is the honest clock for "has it stopped moving"; the timer is only a
  // fallback for a page the browser has stopped painting.
  const nextFrame = (fn) => { let ran = false; const go = () => { if (!ran) { ran = true; fn(); } }; requestAnimationFrame(go); setTimeout(go, 120); };
  const tick = () => {
    if (!el.isConnected) return resolve({ ok: false, why: "it was detached from the page while waiting (the view redrew and replaced it)" });
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const visible = r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    const inert = el.closest("[inert]");
    const disabled = el.disabled === true || !!el.closest("[aria-disabled=\"true\"]") || !!el.closest("fieldset:disabled") || !!inert;
    const box = [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100).join(",");
    if (!visible) { why = "it is attached but not visible"; still = 0; }
    else if (disabled) { why = inert ? "it is inside an inert region (a dialog is open over it)" : "it is disabled"; still = 0; }
    else if (box !== prev) { why = "it is still moving (box " + box + ")"; still = 0; }
    else still++;
    prev = box;
    if (still >= frames) return resolve({ ok: true, box });
    if (performance.now() - t0 > budget) return resolve({ ok: false, why });
    nextFrame(tick);
  };
  nextFrame(tick);
});

/* ---------------------------------------------------------------------
   liveCount
   --------------------------------------------------------------------- */
/**
 * liveCount(page, { kind, category, scope }) -> a number read from the
 * RUNNING app, so no suite carries a literal deck size.
 *
 *   { category: "Army Fitness Test (AFT)" }  board cards in that category
 *   { kind: "board" | "doctrine" | "scenarios" | "creeds" | "recitable" |
 *           "categories" }                   ("categories" = distinct board
 *                                             categories)
 *   scope: "visible" (default)  what THIS Soldier is served - G.store's own
 *                               accessors, so rank, MOS and the confidence
 *                               settings apply exactly as they do on screen
 *          "bank"               everything the build carries
 *                               (window.GUIDON_SEED after every content pack),
 *                               the number tools/assemble-bank.mjs reports
 *
 * Throws when the bank has not loaded, and - unless { allowZero: true } -
 * when the answer is 0: a misspelt category would otherwise make every
 * assertion built on the count quietly vacuous.
 */
export async function liveCount(page, { kind = "board", category = null, scope = "visible", allowZero = false, timeout = PATIENCE_MS } = {}) {
  const KINDS = ["board", "doctrine", "scenarios", "creeds", "recitable", "categories"];
  if (!KINDS.includes(kind)) throw new Error("liveCount: kind must be one of " + KINDS.join(", ") + " - got " + JSON.stringify(kind));
  if (scope !== "visible" && scope !== "bank") throw new Error("liveCount: scope must be \"visible\" or \"bank\"");
  if (category != null && kind !== "board") throw new Error("liveCount: `category` counts board cards - do not combine it with kind: " + JSON.stringify(kind));
  try {
    // The store answers [] until the app's content has loaded; asking early
    // is the "no cards" boot race, so wait for a bank that has cards in it.
    await page.waitForFunction(() => !!(window.G && window.G.store && window.G.store.boardQuestions && window.G.store.boardQuestions().length > 0), null, { timeout });
  } catch (e) {
    throw new Error("liveCount: the app's question bank never loaded within " + timeout + "ms. " + (await onScreen(page)));
  }
  const res = await page.evaluate(({ kind, category, scope }) => {
    const S = window.GUIDON_SEED || {};
    const store = window.G.store;
    const bank = {
      board: () => (S.board && S.board.questions) || [],
      doctrine: () => (S.doctrine && S.doctrine.entries) || [],
      scenarios: () => (S.scenarios && S.scenarios.scenarios) || [],
      creeds: () => S.creeds || [],
    };
    const visible = {
      board: () => store.boardQuestions(),
      doctrine: () => store.doctrine(""),
      scenarios: () => store.scenarios(),
      creeds: () => store.creeds(""),
    };
    const from = scope === "bank" ? bank : visible;
    const board = from.board();
    if (category != null) {
      const n = board.filter((q) => q.category === category).length;
      const near = n ? [] : Array.from(new Set(board.map((q) => q.category))).filter((c) => String(c).toLowerCase().indexOf(String(category).toLowerCase().slice(0, 6)) !== -1).slice(0, 5);
      return { n, near };
    }
    if (kind === "categories") return { n: new Set(board.map((q) => q.category)).size };
    if (kind === "recitable") return { n: scope === "bank" ? board.filter((q) => q.category === "Creeds" && Array.isArray(q.lines) && q.lines.length > 0).length : store.recitable().length };
    return { n: from[kind]().length };
  }, { kind, category, scope });
  if (!res.n && !allowZero) {
    throw new Error("liveCount: " + (category != null ? "no board cards in category " + JSON.stringify(category) + (res.near && res.near.length ? " (did you mean " + res.near.map((c) => JSON.stringify(c)).join(" / ") + "?)" : "") : "the app reports 0 for " + kind) +
      " - pass { allowZero: true } if an empty answer is really what this suite expects.");
  }
  return res.n;
}
