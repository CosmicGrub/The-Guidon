/**
 * Platform-capability registry (src/app-modules/caps.js, G.caps) and its
 * Diagnostics surface (#/selftest, AUTO check id "caps").
 *
 * Collective roadmap P2 (parity design, section 5): capability detection used
 * to be scattered - native.js/biometric.js/notify.js each computed their own
 * isNative from window.Capacitor, pwa.js a broader one, and nothing
 * distinguished the forks at runtime (GUIDON_SINGLEFILE was true in every
 * build). This suite proves the ONE registry exists, every probe is
 * non-throwing and non-destructive in shape (returns a boolean or a string),
 * run() has the documented shape, the build stamps the fork marker, the
 * GUIDON_CAPS console sentinel prints exactly once when asked for and never
 * when not, and the Diagnostics card renders with a Copy JSON button whose
 * clipboard payload parses back to the same registry ids.
 *
 * One browser (lint-ci-matrix counts launch( calls). Runs against web/, the
 * only build that carries pwa.js/native.js - the fork marker there must be
 * "web" (tools/test-standalone.mjs asserts "standalone" for dist/).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const noise = [];
const sentinels = [];
page.on("console", (m) => {
  if (m.type() === "error") noise.push(m.text());
  if (m.text().indexOf("GUIDON_CAPS ") === 0) sentinels.push(m.text());
});
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
// Same allowance as tools/test-selftest.mjs: the "Route health" check renders
// #/library, whose one-time HEAD probe 404s only when web/docs/ is absent.
let docsProbe404 = 0;
page.on("response", (r) => {
  if (!r.ok() && /\/docs\/.*\.pdf$/i.test(new URL(r.url()).pathname)) docsProbe404++;
});

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);

// ---- 1. the registry ----
const reg = await page.evaluate(() => {
  const C = window.G && window.G.caps;
  if (!C || typeof C.list !== "function") return { present: false };
  const list = C.list();
  // expects must carry a value (true/false/null/string, never undefined) for
  // every fork in the ships map plus guest - the keys come from the registry's
  // own ships map, not a second list typed here.
  const EXPECT_KEYS = Object.keys(C.ships || {}).concat("guest");
  const problems = [];
  const ids = [];
  for (const c of list) {
    ids.push(c.id);
    if (typeof c.id !== "string" || !/^[a-z][a-zA-Z0-9]*$/.test(c.id)) problems.push("bad id " + JSON.stringify(c.id));
    if (typeof c.group !== "string" || !c.group) problems.push(c.id + ": missing group");
    if (typeof c.probe !== "function") problems.push(c.id + ": probe is not a function");
    if (!c.expects || EXPECT_KEYS.some((k) => !(k in c.expects) || c.expects[k] === undefined)) problems.push(c.id + ": expects lacks a value for one of " + EXPECT_KEYS.join("/"));
    // ios has no device probe file yet: its network expectations are
    // "probable" strings, never a bare true, until one exists (P2 follow-up).
    if (c.expects && (c.id === "webSocket" || c.id === "rtcDataChannel") && c.expects.ios === true) problems.push(c.id + ": expects.ios is true without a device probe file (must be a \"probable\" string)");
    if (typeof c.degrade !== "string" || !c.degrade) problems.push(c.id + ": missing degrade text");
    if (typeof c.required !== "boolean") problems.push(c.id + ": required is not a boolean");
  }
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const probeResults = {};
  const threw = [];
  for (const c of list) {
    try {
      const v = c.probe();
      probeResults[c.id] = v;
      if (!(typeof v === "boolean" || typeof v === "string")) problems.push(c.id + ": probe returned " + typeof v);
    } catch (e) { threw.push(c.id + ": " + (e && e.message)); }
  }
  const ships = C.ships || null;
  return { present: true, count: list.length, ids, dupes, problems, threw, probeResults, ships,
           required: list.filter((c) => c.required).map((c) => c.id) };
});
if (!reg.present) {
  bad("G.caps registry is missing (G.caps.list is not a function)");
} else {
  reg.count >= 23 ? ok("G.caps.list() is non-empty (" + reg.count + " capabilities)") : bad("registry too small: " + reg.count + " entries (expected at least the 23 the parity design names)");
  reg.dupes.length === 0 ? ok("every capability id is unique") : bad("duplicate ids: " + reg.dupes.join(", "));
  reg.problems.length === 0 ? ok("every entry has id/group/probe/degrade/required and an expects value for every ships-map fork plus guest") : bad("registry shape problems: " + reg.problems.slice(0, 6).join(" | "));
  reg.threw.length === 0 ? ok("every probe runs without throwing and returns a boolean or a string") : bad("probes threw: " + reg.threw.join(" | "));
  reg.required.length > 0 && reg.required.every((id) => reg.ids.includes(id))
    ? ok("required-for-ships set is a non-empty subset of the registry (" + reg.required.join(", ") + ")")
    : bad("required set is empty or names ids outside the registry: " + JSON.stringify(reg.required));
  const shipsOk = reg.ships && ["web", "pwa", "tauri", "android", "standalone"].every((f) => reg.ships[f] === true) && reg.ships.ios === false;
  shipsOk ? ok("ships map: web/pwa/tauri/android/standalone true, ios false") : bad("ships map wrong: " + JSON.stringify(reg.ships));
  // A probe that reports a real value on this engine: Chromium >= 111 has
  // color-mix and IndexedDB, so a false here means the probe, not the engine.
  reg.probeResults.indexeddb === true ? ok("probe indexeddb reports true in this Chromium") : bad("probe indexeddb = " + reg.probeResults.indexeddb);
  reg.probeResults.colorMix === true ? ok("probe colorMix reports true in this Chromium") : bad("probe colorMix = " + reg.probeResults.colorMix);
  typeof reg.probeResults.origin === "string" && /^http:\/\/127\.0\.0\.1:\d+$/.test(reg.probeResults.origin)
    ? ok("probe origin reports the serving origin as a string (" + reg.probeResults.origin + ")")
    : bad("probe origin = " + JSON.stringify(reg.probeResults.origin));
}

// ---- 2. run() shape + the build's fork marker ----
const run = await page.evaluate(async () => {
  const C = window.G && window.G.caps;
  if (!C || typeof C.run !== "function") return { present: false };
  const r = await C.run();
  return { present: true, r, fork: window.GUIDON_FORK, singlefile: window.GUIDON_SINGLEFILE, sha: window.GUIDON_BUILD_SHA,
           jsonType: typeof C.json(), jsonParses: (() => { try { return !!JSON.parse(C.json()); } catch (e) { return false; } })() };
});
if (!run.present) {
  bad("G.caps.run is missing");
} else {
  const r = run.r;
  const KEYS = ["fork", "engine", "ua", "sha", "builtAt", "isVirtual", "caps"];
  KEYS.every((k) => k in r) ? ok("run() resolves with {fork, engine, ua, sha, builtAt, isVirtual, caps}") : bad("run() shape: " + Object.keys(r).join(","));
  r.fork === "web" ? ok("run().fork is \"web\" on the served web/ build") : bad("run().fork = " + JSON.stringify(r.fork));
  r.engine === "chromium" ? ok("run().engine is \"chromium\" under Playwright Chromium") : bad("run().engine = " + JSON.stringify(r.engine));
  typeof r.ua === "string" && r.ua.length > 20 ? ok("run().ua is the user agent string") : bad("run().ua = " + JSON.stringify(r.ua));
  typeof r.isVirtual === "boolean" ? ok("run().isVirtual is a boolean (" + r.isVirtual + ")") : bad("run().isVirtual = " + JSON.stringify(r.isVirtual));
  r.caps && reg.present && Object.keys(r.caps).length === reg.count && reg.ids.every((id) => id in r.caps)
    ? ok("run().caps has exactly one value per registry id (" + Object.keys(r.caps).length + ")")
    : bad("run().caps keys do not match the registry: " + (r.caps ? Object.keys(r.caps).length : "none"));
  typeof r.sha === "string" && /^[0-9a-f]{40}$/.test(r.sha) ? ok("run().sha is a 40-hex git sha stamped by the build (" + r.sha.slice(0, 7) + ")") : bad("run().sha = " + JSON.stringify(r.sha) + " (build.mjs must stamp GUIDON_BUILD_SHA)");
  typeof r.builtAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.builtAt) ? ok("run().builtAt is the build date (" + r.builtAt + ")") : bad("run().builtAt = " + JSON.stringify(r.builtAt));
  run.jsonType === "string" && run.jsonParses ? ok("json() returns a string that JSON.parse accepts") : bad("json() = " + run.jsonType + ", parses=" + run.jsonParses);
}
run.fork === "web" ? ok("window.GUIDON_FORK === \"web\" in web/index.html (stamped by tools/build.mjs)") : bad("window.GUIDON_FORK = " + JSON.stringify(run.fork) + " in web/index.html");
run.singlefile === false ? ok("window.GUIDON_SINGLEFILE === false in web/index.html (true only in dist/)") : bad("window.GUIDON_SINGLEFILE = " + JSON.stringify(run.singlefile) + " in web/index.html");

// ---- 3. the sentinel: never without probe=1 ... ----
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(600);
sentinels.length === 0 ? ok("no GUIDON_CAPS sentinel on a plain #/selftest visit") : bad("sentinel printed without probe=1: " + sentinels.length);
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(1500);
sentinels.length === 0 ? ok("no GUIDON_CAPS sentinel after Run automated checks without probe=1") : bad("sentinel printed by the check run without probe=1: " + sentinels.length);

// ---- 4. the Diagnostics card ----
const card = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /platform capabilities/i.test(n.textContent || ""));
  if (!cat) return null;
  const row = cat.closest(".card");
  const btn = Array.from(row.querySelectorAll("button")).find((b) => /copy json/i.test(b.textContent || ""));
  return { head: cat.textContent, text: row.textContent, hasCopy: !!btn };
});
if (!card) {
  bad("Diagnostics has no 'Platform capabilities' card after a run");
} else {
  /^\u2713/.test(card.head) ? ok("'Platform capabilities' check passes (it is a probe, not a gate)") : bad("card head: " + card.head);
  /fork web/.test(card.text) && /chromium/.test(card.text) && /\d+ supported \/ \d+ probed/.test(card.text)
    ? ok("detail line names fork, engine and N supported / M probed")
    : bad("detail line: " + card.text.slice(0, 200));
  card.hasCopy ? ok("card carries a Copy JSON button") : bad("no Copy JSON button on the card");
}
if (card && card.hasCopy) {
  await page.locator("button", { hasText: /Copy JSON/ }).click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  let parsed = null;
  try { parsed = JSON.parse(clip); } catch (e) {}
  parsed && parsed.caps && reg.present && reg.ids.every((id) => id in parsed.caps)
    ? ok("Copy JSON writes G.caps.json() to the clipboard and it parses back to every registry id")
    : bad("clipboard JSON did not parse or lacks caps: " + String(clip).slice(0, 120));
}

// ---- 5. ... and exactly once with probe=1 ----
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = "#/selftest?probe=1"; });
await page.waitForTimeout(1200);
sentinels.length === 1 ? ok("exactly one GUIDON_CAPS sentinel on #/selftest?probe=1") : bad("sentinel count with probe=1: " + sentinels.length);
let sentinelJson = null;
try { sentinelJson = JSON.parse((sentinels[0] || "").slice("GUIDON_CAPS ".length)); } catch (e) {}
sentinelJson && sentinelJson.fork === "web" && sentinelJson.caps ? ok("sentinel payload parses and carries fork + caps") : bad("sentinel payload: " + String(sentinels[0]).slice(0, 120));
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(1500);
sentinels.length === 1 ? ok("a second run on the same page does not print a second sentinel (once per page)") : bad("sentinel count after re-run: " + sentinels.length);

// ---- 6. the build/test flag path: window.GUIDON_CAPS_PROBE === true ----
const flagged = await context.newPage();
const flagSentinels = [];
flagged.on("console", (m) => { if (m.text().indexOf("GUIDON_CAPS ") === 0) flagSentinels.push(m.text()); });
flagged.on("pageerror", (e) => noise.push("pageerror(flag page): " + e.message));
await flagged.addInitScript(() => { window.GUIDON_CAPS_PROBE = true; });
await flagged.goto(url + "#/selftest", { waitUntil: "load" });
await dismissOnboarding(flagged, { mode: "guest" });
flagSentinels.length === 1 ? ok("window.GUIDON_CAPS_PROBE === true prints exactly one sentinel on a plain #/selftest") : bad("sentinel count with GUIDON_CAPS_PROBE: " + flagSentinels.length);
await flagged.close();

// ---- console cleanliness ----
const DOCS_PROBE_404 = /Failed to load resource: the server responded with a status of 404/;
let allowance = docsProbe404;
const relevant = noise.filter((n) => {
  if (/favicon/.test(n)) return false;
  if (allowance > 0 && DOCS_PROBE_404.test(n)) { allowance--; return false; }
  return true;
});
relevant.length === 0 ? ok("no console errors") : bad("console noise: " + relevant.slice(0, 5).join(" | "));

await browser.close();
await server.close();
console.log(fails ? "\nCAPS: " + fails + " FAILURE(S)" : "\nCAPS: all passed");
process.exit(fails ? 1 : 0);
