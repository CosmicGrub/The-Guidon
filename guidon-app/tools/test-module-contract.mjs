/**
 * The module contract: what src/app-modules/manifest.json CLAIMS, held
 * against what the source SAYS and what the running app DOES.
 *
 * Why this exists. When nine branches were integrated for v1.12.1,
 * recite-user-texts.js still called G.opsecGuard.sanitizeInput - removed by
 * another branch - and because the call sat inside
 *     if (typeof G.opsecGuard.sanitizeInput === "function")
 * "My unit" SILENTLY stopped refusing text that carried a classification
 * marking. Nothing failed. A typeof guard is a promise that an API may be
 * missing; nobody was checking whether the promise was still true. The same
 * week, modules were attaching themselves by replacing core functions, in an
 * order that depended on file names. This suite makes each of those a
 * failure with a file and a line:
 *
 *  (a) STATIC: every guarded call in src/index.html (data lines such as the
 *      seed skipped), the shell scripts and src/app-modules is collected -
 *      typeof G.a.b === / !== "function", G.a && G.a.b(...), if (G.a)
 *      G.a.b(...), G.a?.b(...), and a name that is TESTED in one place and
 *      called in another (if (!G.a || !G.a.b) return x; ... G.a.b(x) - the
 *      early return and the multi-line if, which is how most guards here are
 *      written) - from comment-blanked source, so an API named in prose is
 *      not a guard (tools/module-contract.mjs).
 *  (b) RUNTIME: the real web build is booted and EVERY declared route is
 *      visited (APIs such as G.board.enterTheater only exist once Board Drill
 *      has drawn); the single-file build is booted the same way from file://.
 *      Every guarded name must then be a function in BOTH, unless the
 *      manifest lists it under optionalApis with a written reason. An
 *      unexplained missing name fails, naming the guard's file and line. A
 *      listed name that exists everywhere, or that nothing guards, must leave
 *      the list.
 *  (c) THE MANIFEST'S OTHER CLAIMS: every "provides" name exists and really
 *      comes from that module; a guard that points into a module names
 *      something that module provides; every "routes" entry is registered
 *      and drawn by that module (and the reverse); "patches" are exactly the
 *      functions the module replaces - seen happening, by comparing window.G
 *      before and after each module's <script> runs - so an undeclared
 *      monkeypatch fails; "hooks" are exactly the extension points it
 *      subscribes to, every point core declares really fires with the
 *      screen's element, and nobody subscribes to a point that does not
 *      exist; every module that calls another declares it under requires /
 *      uses; and every storage key a module writes or deletes is declared.
 *      STORAGE KEYS ARE FOUND BY STATIC SCAN of the module's own write calls
 *      (put("kv", { k: ...), setSetting(...), localStorage.setItem(...), and
 *      the delete forms). It cannot see a row written for the module by a
 *      core API (G.reminders.add, G.store.recordAttempt - those rows are
 *      core's), and a key it cannot reduce to a literal or a literal prefix
 *      is itself a failure rather than a blind spot.
 *  (d) SELF-CHECK: the verifier is run against planted defects and must
 *      fail, naming them - a stand-in copy of recite-user-texts.js with
 *      typeof G.opsecGuard.sanitizeInput === "function" restored, a stand-in
 *      copy of moi-import.js whose early-return guard (if (!str ||
 *      !G.opsecGuard || !G.opsecGuard.screen) return str;) points at that
 *      removed name instead, a stand-in
 *      module with an undeclared storage write / core patch / misspelt
 *      extension point / undeclared dependency, and manifests with a patch,
 *      a hook, a route or a provided name mis-declared.
 *
 *   node tools/test-module-contract.mjs                 the suite
 *   node tools/test-module-contract.mjs --src <dir>     hold a stand-in copy of
 *        src/ (any subset of index.html, *.js, app-modules/*.js, and its own
 *        app-modules/manifest.json if it has one) to the same contract against
 *        the real build; exits 1 naming each breach. One browser either way.
 */
import { chromium } from "playwright";
import vm from "node:vm";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { declaredRoutes } from "./declared-routes.mjs";
import { loadModules, readManifest } from "./module-manifest.mjs";
import { readSources, collectGuards, collectStorage, collectAssignments, collectReferences, collectExtUse, keyCovered, fingerprint, blankSource } from "./module-contract.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));
const show = (arr, n = 8) => arr.slice(0, n).join("\n          ") + (arr.length > n ? `\n          (+${arr.length - n} more)` : "");

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const STAND_IN = argOf("--src") ? resolve(argOf("--src")) : null;

console.log("module contract: the manifest's claims, the source, and the running app" + (STAND_IN ? `  (--src ${STAND_IN})` : "") + "\n");

/* =====================================================================
   Static facts about a src folder
   ===================================================================== */
function staticFacts(srcDir) {
  const sources = readSources(srcDir);
  const modules = sources.filter((s) => s.kind === "module");
  return {
    sources, modules,
    guards: collectGuards(sources),
    ext: collectExtUse(sources),
    storage: new Map(modules.map((s) => [s.file, collectStorage(s)])),
    assignments: new Map(modules.map((s) => [s.file, collectAssignments(s)])),
    references: new Map(modules.map((s) => [s.file, collectReferences(s)])),
  };
}

const real = staticFacts("src");
const realManifest = loadModules().manifest;

/* ---- the scanner itself: comments are not code, code still compiles, every shape is seen ---- */
if (!STAND_IN) {
  const broken = [];
  for (const s of real.sources) {
    for (const variant of ["text", "code"]) {
      const blocks = s.blocks ? s.blocks.map(([a, b]) => s[variant].slice(a, b)) : [s[variant]];
      blocks.forEach((b, i) => { try { new vm.Script(b, { filename: s.label }); } catch (e) { broken.push(`${s.label}${blocks.length > 1 ? " <script> " + (i + 1) : ""} (${variant}): ${e.message}`); } });
    }
  }
  check(broken.length === 0, `with comments blanked, and again with string / template / regular-expression contents blanked too, all ${real.sources.length} source files still compile (a tokenizer that ate real code would break one)`, "comment-blanked source no longer compiles - the scanner mis-read a string, template or regular expression:\n          " + show(broken));
  const sample = [
    "// typeof G.prose.one === \"function\" in a line comment",
    "/* G.prose && G.prose.two() in a block",
    "   comment that runs on */",
    "var s = \"typeof G.inString.x === 'function'\"; var re = /G\\.a && G\\.a\\.b\\(/; // trailing typeof G.prose.three === \"function\"",
    "if (typeof G.alpha.one === \"function\") G.alpha.one();",
    "if (typeof G.alpha.two !== 'function') return;",
    "if (\"function\" === typeof window.G.alpha.three) x();",
    "var v = G.bravo && G.bravo.one(1);",
    "var w = G.bravo && G.bravo.two ? G.bravo.two(1) : null;",
    "if (G.bravo && G.bravo.three && G.bravo.three.deep) G.bravo.three.deep();",
    "if (G.charlie) G.charlie.one();",
    "G.delta?.one(); G.delta.two?.();",
    "var data = G.echo && G.echo.value;            // data, not a call",
    "var t = `${G.foxtrot && G.foxtrot.one()}`;",
    "if (G.golf.one) G.golf.one();                  // the test and the call name the same thing",
    "var u = G.golf.two ? G.golf.two(1) : null;",
    "if (G.hotel && G.hotel.one) {                  // tested here ...",
    "  G.hotel.one(1);                              // ... called on another line",
    "}",
    "function early(str) { if (!str || !G.india || !G.india.one) return str;",
    "  return G.india.one(str); }",
    "if (!G.juliet || !G.juliet.value) return;      // tested but never called: data, not a guard",
    "if (G.kilo) G.kilo.apply(1);                   // what is called is G.kilo.apply, not G.kilo",
    "var z = G.lima.one(G.lima.two(1)); if (G.lima && G.lima.two) z();   // a call inside another call's brackets still counts as called",
  ].join("\n");
  const found = collectGuards([{ label: "sample.js", kind: "module", file: "sample.js", ...blankSource(sample) }]).map((g) => g.name + "@" + g.line + ":" + g.shape).sort();
  const want = ["G.alpha.one@5:typeof", "G.alpha.two@6:typeof", "G.alpha.three@7:typeof", "G.bravo.one@8:and-call", "G.bravo.two@9:and-call", "G.bravo.three.deep@10:and-call", "G.charlie.one@11:if-call", "G.delta.one@12:optional", "G.delta.two@12:optional", "G.foxtrot.one@14:and-call",
    "G.golf.one@15:if-call", "G.golf.two@16:tested", "G.hotel.one@17:tested", "G.india.one@20:tested", "G.kilo.apply@23:if-call", "G.lima.two@24:tested"].sort();
  check(JSON.stringify(found) === JSON.stringify(want), `the scanner finds every guard shape (${want.length} planted in a sample) and nothing in comments, strings, regular expressions or data guards`, "scanner sample mismatch:\n          found   " + JSON.stringify(found) + "\n          wanted  " + JSON.stringify(want));
}

/* =====================================================================
   Planted stand-ins (self-check). Built before the browser starts so ONE
   boot can answer for the real tree and for every planted name.
   ===================================================================== */
const scratch = mkdtempSync(join(tmpdir(), "guidon-module-contract-"));
const planted = {};
if (!STAND_IN) {
  const modSrc = (f) => readFileSync(join("src", "app-modules", f), "utf8");
  // (1) the v1.12.1 seam, restored: one module, one guard pointing at an API that no longer exists.
  const dirA = join(scratch, "restored-guard", "app-modules"); mkdirSync(dirA, { recursive: true });
  const before = 'typeof G.opsecGuard.screen === "function"', after = 'typeof G.opsecGuard.sanitizeInput === "function"';
  const recite = modSrc("recite-user-texts.js");
  planted.guardPlantable = recite.split(before).length === 2;
  writeFileSync(join(dirA, "recite-user-texts.js"), recite.replace(before, after));
  planted.guardLine = recite.slice(0, recite.indexOf(before)).split("\n").length;
  planted.restoredGuard = staticFacts(join(scratch, "restored-guard"));
  // (1b) the same seam in the shape this code base mostly uses: an early return, with the call on the
  // next line. moi-import.js keeps a string out of the saved plan unless G.opsecGuard.screen found
  // nothing in it; pointed at a name that no longer exists, it hands every string back unchecked.
  const dirA2 = join(scratch, "early-return-guard", "app-modules"); mkdirSync(dirA2, { recursive: true });
  const moi = modSrc("moi-import.js");
  const earlyGuard = "if (!str || !G.opsecGuard || !G.opsecGuard.screen) return str;", earlyCall = "return G.opsecGuard.screen(str).findings.length ? null : str;";
  const renamed = (line) => line.replace("opsecGuard.screen", "opsecGuard.sanitizeInput");
  planted.earlyPlantable = moi.split(earlyGuard).length === 2 && moi.split(earlyCall).length === 2;
  writeFileSync(join(dirA2, "moi-import.js"), moi.replace(earlyGuard, renamed(earlyGuard)).replace(earlyCall, renamed(earlyCall)));
  planted.earlyLine = moi.slice(0, moi.indexOf(earlyGuard)).split("\n").length;
  planted.earlyReturnGuard = staticFacts(join(scratch, "early-return-guard"));
  // (2) a module that writes an undeclared key, replaces a core function, subscribes to a misspelt point, calls an undeclared module.
  const dirB = join(scratch, "rogue-module", "app-modules"); mkdirSync(dirB, { recursive: true });
  writeFileSync(join(dirB, "pt-planner.js"), modSrc("pt-planner.js") + [
    "", ";(function () {", "  var G = window.G;",
    '  G.db.setSetting("pt:planted:v1", 1);',
    '  G.db.put("kv", { k: "pt:" + Date.now(), v: 1 });',
    '  G.db.put("kv", { k: somethingOnlyKnownLater(), v: 1 });',
    "  G.board.render = function () {};",
    '  G.ext.on("bord:rendered", function () {});',
    "  if (G.assignments) G.assignments.render(document.body);",
    "})();", ""].join("\n"));
  planted.rogueModule = staticFacts(join(scratch, "rogue-module"));
}
const standIn = STAND_IN ? staticFacts(STAND_IN) : null;
const standInManifest = STAND_IN && existsSync(join(STAND_IN, "app-modules", "manifest.json")) ? readManifest(join(STAND_IN, "app-modules")).manifest : realManifest;

const allGuardNames = new Set();
for (const facts of [real, standIn, planted.restoredGuard, planted.earlyReturnGuard, planted.rogueModule]) if (facts) for (const g of facts.guards) allGuardNames.add(g.name);
for (const man of [realManifest, standInManifest]) {
  for (const m of man.modules) { for (const p of m.provides) allGuardNames.add(p); for (const o of m.optionalApis) allGuardNames.add(o.name); }
  for (const o of ((man.core || {}).optionalApis || [])) allGuardNames.add(o.name);
}
allGuardNames.add("G.contract.plantedOptionalThatIsMissingEverywhere");
const NAMES = [...allGuardNames];

/* =====================================================================
   Runtime facts - one browser, two pages (web/ over http, the single
   file over file://).
   ===================================================================== */
/* Runs before any page script. At every <script> boundary (the parser's
   microtask checkpoint before a script executes - which is when a
   MutationObserver hears that the element was added) it records how window.G
   differs from the previous boundary, and which script is about to run.
   Observation only: nothing on G is wrapped, replaced or delayed. */
const INIT = () => {
  const C = (window.__contract = { boundaries: [], notes: [] });
  const ids = new Map(); let nextId = 1;
  const idOf = (v) => { let n = ids.get(v); if (!n) { n = nextId++; ids.set(v, n); } return n; };
  const fp = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return text.length + ":" + h.toString(16); };
  const snap = () => {
    const out = new Map(); const G = window.G;
    if (!G || typeof G !== "object") return out;
    const walk = (obj, path, depth) => {
      let keys; try { keys = Object.keys(obj); } catch (e) { return; }
      if (keys.length > 400) return;
      for (const k of keys) {
        let v; try { v = obj[k]; } catch (e) { continue; }
        const p = path + "." + k;
        if (typeof v === "function") out.set(p, "f" + idOf(v));
        else if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Node) && depth < 4) { out.set(p, "o"); walk(v, p, depth + 1); }
        else out.set(p, "v");
      }
    };
    walk(G, "G", 1);
    if (G.ext && typeof G.ext.points === "function") for (const n of G.ext.points()) out.set("ext:" + n, "c" + G.ext.count(n));
    return out;
  };
  let prev = new Map();
  const delta = () => {
    const now = snap(), added = [], changed = [];
    for (const [k, v] of now) { if (!prev.has(k)) added.push([k, v[0], v]); else if (prev.get(k) !== v) changed.push([k, prev.get(k), v]); }
    prev = now;
    return { added, changed };
  };
  const mo = new MutationObserver((records) => {
    const scripts = [];
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && n.tagName === "SCRIPT") scripts.push(n);
    if (!scripts.length) return;
    const d = delta();
    // The node is kept and fingerprinted LATER: a multi-megabyte inline script (library.js) reaches the
    // DOM in pieces, and this callback can run when only the first piece of its text is there.
    scripts.forEach((n, i) => C.boundaries.push({ node: n, about: null, sharedBatch: scripts.length > 1, delta: i === 0 ? d : { added: [], changed: [] } }));
  });
  mo.observe(document, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => { C.boundaries.push({ node: null, about: null, sharedBatch: false, delta: delta() }); mo.disconnect(); }, { once: true, capture: true });
  C.seal = () => C.boundaries.map((b) => ({ about: b.node ? fp(b.node.textContent || "") : null, sharedBatch: b.sharedBatch, delta: b.delta }));
};

const moduleFp = new Map(real.modules.map((s) => [fingerprint("\n" + s.raw + "\n"), s.file]));

async function bootAndVisit(browser, label, target, routes) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.addInitScript(INIT);
  await page.goto(target, { waitUntil: "load" });
  await dismissOnboarding(page);
  // Listen on every extension point through the public API, to see each one really fire.
  await page.evaluate(() => {
    window.__contract.fired = {};
    if (window.G && G.ext && G.ext.points) for (const n of G.ext.points()) G.ext.on(n, function (mount) { (window.__contract.fired[n] = window.__contract.fired[n] || []).push(mount instanceof Element); });
  });
  const unsettled = [];
  for (const h of routes) {
    await page.evaluate((hh) => { window.__contract.settle = null; location.hash = hh; }, h);
    // "Drawn": on this route, with something in the frame, and the frame's markup unchanged for 150 ms.
    await page.waitForFunction((hh) => {
      if (location.hash !== hh) return false;
      const r = document.getElementById("route");
      if (!r || !r.firstElementChild || !r.firstElementChild.childElementCount) return false;
      const n = r.innerHTML.length, s = window.__contract.settle;
      if (!s || s.n !== n) { window.__contract.settle = { n: n, t: performance.now() }; return false; }
      return performance.now() - s.t >= 150;
    }, h, { polling: 50, timeout: 20000 }).catch(() => unsettled.push(h));
  }
  const facts = await page.evaluate((names) => {
    const typeOf = (n) => { let o = window; for (const part of n.split(".")) { o = o == null ? undefined : o[part]; } return typeof o; };
    return {
      types: Object.fromEntries(names.map((n) => [n, typeOf(n)])),
      routes: (window.G.routes || []).map((r) => ({ hash: r.hash, src: String(r.render) })),
      points: window.G.ext && G.ext.points ? G.ext.points() : null,
      fired: window.__contract.fired,
      boundaries: window.__contract.seal(),
      fork: window.GUIDON_FORK,
    };
  }, NAMES);
  await ctx.close();
  // Attribute each boundary-to-boundary delta to the script that ran between them.
  const perModule = new Map(), before = new Map(); let state = new Map(), ambiguous = [];
  const B = facts.boundaries;
  for (let k = 0; k < B.length; k++) {
    for (const [name, , v] of B[k].delta.added) state.set(name, v);
    for (const [name, , v] of B[k].delta.changed) state.set(name, v);
    if (k > 0) {
      const file = moduleFp.get(B[k - 1].about);
      if (file) {
        if (B[k - 1].sharedBatch || B[k].sharedBatch) ambiguous.push(file);
        const d = B[k].delta;
        perModule.set(file, {
          added: d.added.filter(([n]) => !n.startsWith("ext:")).map(([n]) => n),
          patched: d.changed.filter(([n, a, b]) => !n.startsWith("ext:") && (a[0] === "f" || b[0] === "f")).map(([n]) => n),
          hooks: [...d.added, ...d.changed].filter(([n, a, b]) => n.startsWith("ext:") && Number(String(b).slice(1)) > (a === "c" ? 0 : Number(String(a).slice(1)) || 0)).map(([n]) => n.slice(4)),
        });
      }
    }
    const next = moduleFp.get(B[k].about);
    if (next) before.set(next, new Map(state));
  }
  return { label, facts, perModule, before, noise, unsettled, ambiguous };
}

const { hashes: ROUTES } = await declaredRoutes("web/index.html");
const { server, url } = await serve("web");
const browser = await chromium.launch();
let web = null, single = null, bootError = null;
try {
  web = await bootAndVisit(browser, "web", url, ROUTES);
  single = await bootAndVisit(browser, "single-file", pathToFileURL(resolve("dist/guidon-standalone.html")).href, ROUTES);
} catch (e) { bootError = e; }
await browser.close();
server.close();
if (bootError) { bad("could not boot and walk the builds: " + (bootError.stack || bootError.message)); console.log("\nMODULE CONTRACT: 1 failed"); rmSync(scratch, { recursive: true, force: true }); process.exit(1); }
const BUILDS = [web, single];

/* =====================================================================
   The judge: static facts + runtime facts + a manifest -> breaches
   ===================================================================== */
function judge(facts, manifest, { partial = false } = {}) {
  const breaches = [];
  const say = (rule, msg) => breaches.push({ rule, msg });
  const mods = manifest.modules;
  const byFile = new Map(mods.map((m) => [m.file, m]));
  const present = new Set(facts.modules.map((s) => s.file));
  const optional = new Map();
  for (const o of ((manifest.core || {}).optionalApis || [])) optional.set(o.name, { where: "core", why: o.why });
  for (const m of mods) for (const o of m.optionalApis) optional.set(o.name, { where: m.file, why: o.why });
  const typeIn = (b, n) => b.facts.types[n];
  const isFn = (n) => BUILDS.every((b) => typeIn(b, n) === "function");
  // Which module ADDED a name (or the nearest enclosing name) as it loaded.
  const addedBy = new Map();
  for (const [file, d] of web.perModule) for (const n of d.added) if (!addedBy.has(n)) addedBy.set(n, file);
  const ownedVia = (name) => { const parts = name.split("."); for (let i = parts.length; i >= 2; i--) { const prefix = parts.slice(0, i).join("."); if (addedBy.has(prefix)) return prefix; } return null; };
  const ownerOf = (name) => { const via = ownedVia(name); return via ? addedBy.get(via) : null; };

  // (A) guarded names exist, or are explained
  const guardedNames = new Set(facts.guards.map((g) => g.name));
  for (const g of facts.guards) {
    if (isFn(g.name)) continue;
    const missingIn = BUILDS.filter((b) => typeIn(b, g.name) !== "function").map((b) => b.label + " build (" + typeIn(b, g.name) + ")");
    if (optional.has(g.name)) continue;
    say("guard", `${g.file}:${g.line} guards ${g.name} (${g.shape}), which is not a function in the ${missingIn.join(" or the ")} even after every route has been visited, and no optionalApis entry says why. If that API was removed or renamed, this guard now silently skips its branch - fix the call; if it is genuinely absent on some builds, list it under optionalApis with the reason.`);
  }
  if (!partial) for (const [name, o] of optional) {
    if (isFn(name)) say("optional-stale", `${name} is listed under optionalApis (${o.where}: "${o.why}") but it is a function in every build - remove the entry, so the list only ever holds APIs that really can be missing`);
    else if (!guardedNames.has(name)) say("optional-stale", `${name} is listed under optionalApis (${o.where}) but no guarded call in the source names it - remove the entry`);
  }
  // (B) a guard that points into a module names something that module provides
  for (const g of facts.guards) {
    const owner = ownerOf(g.name); if (!owner) continue;
    const m = byFile.get(owner);
    if (m && !m.provides.includes(g.name)) say("guard-provides", `${g.file}:${g.line} guards ${g.name}, which belongs to src/app-modules/${owner} (it is what adds ${ownedVia(g.name)}), but that module's manifest entry does not list ${g.name} under "provides" - declare it there, so removing it becomes a reviewed change instead of a silent skip here`);
  }
  // (C) provides
  if (!partial) for (const m of mods) for (const p of m.provides) {
    const gone = BUILDS.filter((b) => typeIn(b, p) === "undefined").map((b) => b.label);
    if (gone.length) say("provides", `src/app-modules/${m.file} says it provides ${p}, but that does not exist in the ${gone.join(" / ")} build`);
    else if (ownerOf(p) !== m.file && !(web.perModule.get(m.file) || { patched: [] }).patched.includes(p)) say("provides", `src/app-modules/${m.file} says it provides ${p}, but ${ownerOf(p) ? "src/app-modules/" + ownerOf(p) : "core"} is what defines it`);
  }
  // (D) routes, both directions
  if (!partial) {
    const registered = new Map(web.facts.routes.map((r) => [r.hash, r.src]));
    for (const m of mods) for (const h of m.routes) {
      if (!registered.has(h)) { say("routes", `src/app-modules/${m.file} lists the route ${h}, which is not registered in the running app`); continue; }
      const names = [...registered.get(h).matchAll(/\bG((?:\.[A-Za-z_$][\w$]*)+)/g)].map((x) => "G" + x[1]);
      if (!names.some((n) => ownerOf(n) === m.file)) say("routes", `src/app-modules/${m.file} lists the route ${h}, but that route's render (${registered.get(h).replace(/\s+/g, " ").slice(0, 80)}) does not call into this module`);
    }
    for (const [h, src] of registered) for (const x of src.matchAll(/\bG((?:\.[A-Za-z_$][\w$]*)+)/g)) {
      const owner = ownerOf("G" + x[1]);
      if (owner && byFile.get(owner) && !byFile.get(owner).routes.includes(h)) say("routes", `the route ${h} is drawn by src/app-modules/${owner} (${"G" + x[1]}) but that module's manifest entry does not list it under "routes"`);
    }
  }
  // (E) patches: seen at load, and assigned in the source
  for (const m of mods) {
    const declared = (m.patches || []);
    if (!partial) {
      const seen = (web.perModule.get(m.file) || { patched: [] }).patched;
      for (const n of seen) if (!declared.some((p) => p.name === n && p.when === "load")) say("patches", `src/app-modules/${m.file} REPLACES ${n} as it loads (seen: the function on window.G changed while this file's <script> ran) but its manifest entry does not declare that under "patches" - use a named extension point (G.ext) instead, or declare the patch with a reason`);
      for (const p of declared.filter((x) => x.when === "load")) if (!seen.includes(p.name)) say("patches", `src/app-modules/${m.file} declares a load-time patch of ${p.name}, but that function was not replaced while the file loaded - remove the stale entry`);
    }
    if (!present.has(m.file)) continue;
    const was = web.before.get(m.file) || new Map();
    const assigned = facts.assignments.get(m.file) || [];
    for (const a of assigned) {
      if (String(was.get(a.name) || "")[0] !== "f") continue; // only a function that already existed can be PATCHED
      if (!declared.some((p) => p.name === a.name)) say("patches", `${a.file}:${a.line} assigns ${a.name}${a.via !== "G" ? " (through the alias " + a.via + ")" : ""}, a function that already exists when this module loads, but its manifest entry does not declare it under "patches"`);
    }
    for (const p of declared.filter((x) => x.when === "call")) if (!assigned.some((a) => a.name === p.name)) say("patches", `src/app-modules/${m.file} declares a call-time patch of ${p.name}, but nothing in the file assigns it - remove the stale entry`);
  }
  // (F) extension points and hooks
  const corePoints = ((manifest.core || {}).extensionPoints || []);
  for (const o of facts.ext.ons) if (!corePoints.includes(o.name)) say("hooks", `${o.file}:${o.line} subscribes to the extension point "${o.name}", which core does not declare - the handler would never run`);
  for (const r of facts.ext.runs) if (!corePoints.includes(r.name)) say("hooks", `${r.file}:${r.line} runs the extension point "${r.name}", which manifest.json core.extensionPoints does not list`);
  for (const m of mods) {
    if (!present.has(m.file)) continue;
    const inSource = [...new Set(facts.ext.ons.filter((o) => o.file === "src/app-modules/" + m.file).map((o) => o.name))].filter((n) => corePoints.includes(n));
    for (const n of inSource) if (!(m.hooks || []).includes(n)) say("hooks", `src/app-modules/${m.file} subscribes to "${n}" but its manifest entry does not list it under "hooks"`);
  }
  if (!partial) {
    for (const b of BUILDS) if (JSON.stringify(b.facts.points) !== JSON.stringify(corePoints)) say("hooks", `manifest.json core.extensionPoints is ${JSON.stringify(corePoints)} but the ${b.label} build's G.ext.points() is ${JSON.stringify(b.facts.points)}`);
    for (const p of corePoints) {
      if (!facts.ext.runs.some((r) => r.kind === "core" && r.name === p)) say("hooks", `core.extensionPoints lists "${p}" but src/index.html never runs it`);
      for (const b of BUILDS) { const f = (b.facts.fired || {})[p] || []; if (!f.length || !f.every(Boolean)) say("hooks", `the extension point "${p}" ${f.length ? "fired without the screen's element" : "never fired"} in the ${b.label} build while every route was visited`); }
    }
    for (const m of mods) {
      const seen = (web.perModule.get(m.file) || { hooks: [] }).hooks.slice().sort(), declared = (m.hooks || []).slice().sort();
      if (JSON.stringify(seen) !== JSON.stringify(declared)) say("hooks", `src/app-modules/${m.file} declares hooks ${JSON.stringify(declared)} but subscribed to ${JSON.stringify(seen)} as it loaded`);
    }
  }
  // (G) storage keys (static scan of the module's own write / delete calls)
  for (const m of mods) {
    if (!present.has(m.file)) continue;
    const ops = facts.storage.get(m.file) || [];
    const owns = m.storageKeys, clears = (m.clearsKeys || []);
    for (const o of ops) {
      if (!o.keys) { say("storage", `${o.file}:${o.line} ${o.op === "write" ? "writes" : "deletes"} a storage key this scan cannot read (${o.expr.slice(0, 60)}) - use a literal, a constant, or a "prefix:" + id expression, so the key can be declared`); continue; }
      for (const k of o.keys) {
        if (o.op === "write" && !keyCovered(k, owns)) say("storage", `${o.file}:${o.line} writes the storage key "${k}" but the module's manifest entry does not declare it under "storageKeys"`);
        if (o.op === "delete" && !keyCovered(k, owns) && !keyCovered(k, clears)) say("storage", `${o.file}:${o.line} deletes the storage key "${k}" but the module's manifest entry declares it under neither "storageKeys" nor "clearsKeys"`);
      }
    }
    const written = ops.filter((o) => o.op === "write" && o.keys).flatMap((o) => o.keys), deleted = ops.filter((o) => o.op === "delete" && o.keys).flatMap((o) => o.keys);
    for (const k of owns) if (!written.some((w) => w === k || keyCovered(w, [k]))) say("storage", `src/app-modules/${m.file} declares the storage key "${k}" but never writes it - remove the stale entry`);
    for (const k of clears) if (!deleted.some((w) => w === k || keyCovered(w, [k]))) say("storage", `src/app-modules/${m.file} declares "${k}" under clearsKeys but never deletes it - remove the stale entry`);
  }
  // (H) a module that calls another module says so
  const idOfFile = new Map(mods.map((m) => [m.file, m.id]));
  for (const m of mods) {
    if (!present.has(m.file)) continue;
    const declared = new Set([...(m.requires || []), ...(m.uses || [])]);
    const needs = new Map();
    for (const n of (facts.references.get(m.file) || [])) { const owner = ownerOf(n); if (owner && owner !== m.file && !needs.has(owner)) needs.set(owner, n); }
    for (const [owner, via] of needs) if (!declared.has(idOfFile.get(owner))) say("requires", `src/app-modules/${m.file} uses ${via}, which src/app-modules/${owner} provides, but declares "${idOfFile.get(owner)}" under neither "requires" nor "uses"`);
  }
  return breaches;
}

/* =====================================================================
   Verdicts
   ===================================================================== */
const report = (breaches) => show(breaches.map((b) => `[${b.rule}] ${b.msg}`), process.env.CONTRACT_SHOW_ALL ? 999 : 12);

for (const b of BUILDS) {
  check(b.unsettled.length === 0, `${b.label} build: all ${ROUTES.length} declared routes were visited and drew`, `${b.label} build: route(s) that never finished drawing: ${b.unsettled.join(", ")}`);
  check(b.perModule.size === realManifest.modules.length && b.ambiguous.length === 0, `${b.label} build: every one of the ${realManifest.modules.length} module scripts was seen loading, each on its own`, `${b.label} build: module scripts seen ${b.perModule.size} of ${realManifest.modules.length}; not separable: ${JSON.stringify(b.ambiguous)}`);
  check(b.noise.length === 0, `${b.label} build: no console errors/warnings or page errors`, `${b.label} build: console noise: ${b.noise.slice(0, 5).join(" | ")}`);
}
{
  const flat = (b) => JSON.stringify([...b.perModule].map(([f, d]) => [f, d.added.slice().sort(), d.patched.slice().sort(), d.hooks.slice().sort()]).sort());
  check(flat(web) === flat(single), "every module adds, replaces and subscribes to exactly the same things in the web build and in the single-file build", "the web and single-file builds differ in what a module adds / patches / subscribes to");
}

if (STAND_IN) {
  const breaches = judge(standIn, standInManifest, { partial: true });
  check(standIn.sources.length > 0, `read ${standIn.sources.length} source file(s) from the stand-in, ${standIn.guards.length} guarded call(s)`, "the stand-in folder has no index.html, shell script or app-modules/*.js to read");
  check(breaches.length === 0, "the stand-in keeps the module contract", `the stand-in breaks the module contract (${breaches.length}):\n          ` + report(breaches));
} else {
  const breaches = judge(real, realManifest);
  const names = new Set(real.guards.map((g) => g.name));
  check(breaches.filter((b) => b.rule === "guard" || b.rule === "optional-stale").length === 0,
    `(a)(b) all ${real.guards.length} guarded calls (${names.size} API names) resolve to a function in both builds after every route was visited, or are listed as optional with a reason`,
    "(a)(b) guarded APIs:\n          " + report(breaches.filter((b) => b.rule === "guard" || b.rule === "optional-stale")));
  const rules = [["guard-provides", "every guard that points into a module names something that module lists under provides"],
    ["provides", `every "provides" name exists in both builds and really comes from the module that claims it (${realManifest.modules.reduce((n, m) => n + m.provides.length, 0)} names)`],
    ["routes", `every "routes" entry is a registered route drawn by that module, and every module-drawn route is declared (${realManifest.modules.reduce((n, m) => n + m.routes.length, 0)} routes)`],
    ["patches", `the only functions a module replaces are the ones its entry declares (${realManifest.modules.flatMap((m) => (m.patches || []).map((p) => p.name + " [" + p.when + "]")).join(", ") || "none"})`],
    ["hooks", `extension points: core declares ${JSON.stringify(realManifest.core.extensionPoints)}, each fired with the screen's element in both builds, and each module's "hooks" are exactly what it subscribed to`],
    ["storage", `every storage key a module writes or deletes is declared, and no declared key is stale (static scan of the modules' own write calls; rows a core API writes for a module are core's)`],
    ["requires", "every module that calls into another module declares it under requires / uses"]];
  for (const [rule, pass] of rules) { const got = breaches.filter((b) => b.rule === rule); check(got.length === 0, "(c) " + pass, `(c) ${rule}:\n          ` + report(got)); }

  /* ---- (d) the verifier fails on planted defects ---- */
  check(planted.guardPlantable, "(d) recite-user-texts.js still carries the opsecGuard guard this self-check plants its defect into", "(d) recite-user-texts.js no longer contains typeof G.opsecGuard.screen === \"function\" exactly once - re-point this self-check at the module's current guard");
  const expectBreach = (breaches, rule, re, what) => check(breaches.some((b) => b.rule === rule && re.test(b.msg)), "(d) planted defect caught: " + what, `(d) planted defect NOT caught: ${what}\n          wanted a [${rule}] breach matching ${re}\n          got: ${report(breaches) || "(none)"}`);
  const A = judge(planted.restoredGuard, realManifest, { partial: true });
  expectBreach(A, "guard", new RegExp(String.raw`src/app-modules/recite-user-texts\.js:${planted.guardLine} guards G\.opsecGuard\.sanitizeInput \(typeof\)`), `typeof G.opsecGuard.sanitizeInput === "function" restored in a copy of recite-user-texts.js fails, naming the guard, the file and line ${planted.guardLine}`);
  expectBreach(A, "guard-provides", /recite-user-texts\.js:\d+ guards G\.opsecGuard\.sanitizeInput, which belongs to src\/app-modules\/05-opsec-guard\.js \(it is what adds G\.opsecGuard\), but that module's manifest entry does not list G\.opsecGuard\.sanitizeInput under "provides"/, "...and it is also reported as an API the opsec-guard module never declared");
  check(A.length === 2 && A.every((b) => /G\.opsecGuard\.sanitizeInput/.test(b.msg)), "(d) ...and nothing else in that stand-in is reported (the rest of the module still keeps the contract)", "(d) the restored-guard stand-in produced other breaches too:\n          " + report(A));
  check(planted.earlyPlantable, "(d) moi-import.js still carries the early-return opsecGuard guard the second self-check plants its defect into", "(d) moi-import.js no longer contains its cleanForPlan() guard and call exactly once each - re-point this self-check at the module's current early-return guard");
  const A2 = judge(planted.earlyReturnGuard, realManifest, { partial: true });
  expectBreach(A2, "guard", new RegExp(String.raw`src/app-modules/moi-import\.js:${planted.earlyLine} guards G\.opsecGuard\.sanitizeInput \(tested\)`), `the same removed API behind an EARLY RETURN in a copy of moi-import.js (if (!str || !G.opsecGuard || !G.opsecGuard.sanitizeInput) return str;) fails, naming the guard, the file and line ${planted.earlyLine}`);
  check(A2.length > 0 && A2.every((b) => /G\.opsecGuard\.sanitizeInput/.test(b.msg)), "(d) ...and nothing else in that stand-in is reported", "(d) the early-return stand-in produced other breaches too:\n          " + report(A2));
  const B = judge(planted.rogueModule, realManifest, { partial: true });
  expectBreach(B, "storage", /pt-planner\.js:\d+ writes the storage key "pt:planted:v1"/, "an undeclared storage key write");
  expectBreach(B, "storage", /pt-planner\.js:\d+ writes the storage key "pt:\*"/, "an undeclared key prefix write");
  expectBreach(B, "storage", /pt-planner\.js:\d+ writes a storage key this scan cannot read \(somethingOnlyKnownLater\(\)\)/, "a key the static scan cannot read is a failure, not a blind spot");
  expectBreach(B, "patches", /pt-planner\.js:\d+ assigns G\.board\.render, a function that already exists/, "a module that replaces G.board.render without declaring it");
  expectBreach(B, "hooks", /pt-planner\.js:\d+ subscribes to the extension point "bord:rendered", which core does not declare/, "a subscription to a misspelt extension point");
  expectBreach(B, "requires", /pt-planner\.js uses G\.assignments[.\w]*, which src\/app-modules\/assignments\.js provides, but declares "assignments" under neither/, "a call into another module that the manifest does not declare");
  {
    const rulesHit = [...new Set(B.map((b) => b.rule))].sort();
    check(JSON.stringify(rulesHit) === JSON.stringify(["hooks", "patches", "requires", "storage"]), "(d) ...and the rules that stand-in does NOT break stay quiet (no false alarms)", "(d) the rogue-module stand-in tripped unexpected rules: " + JSON.stringify(rulesHit) + "\n          " + report(B));
  }
  // Manifest-side defects: the source is the real tree, the claims are wrong.
  const clone = () => JSON.parse(JSON.stringify(realManifest));
  const tweak = (fn) => { const m = clone(); fn(m, (id) => m.modules.find((x) => x.id === id)); return judge(real, m); };
  expectBreach(tweak((m, mod) => { mod("roadmap-bootstrap").patches = []; }), "patches", /00-roadmap-bootstrap\.js REPLACES G\.engine\.run as it loads/, "the G.engine.run replacement with its manifest declaration removed (an undeclared monkeypatch)");
  expectBreach(tweak((m, mod) => { mod("pt-planner").patches = [{ name: "G.engine.run", when: "load", why: "planted: it does not" }]; }), "patches", /pt-planner\.js declares a load-time patch of G\.engine\.run, but that function was not replaced/, "a declared patch that does not happen");
  expectBreach(tweak((m, mod) => { mod("mock-board-simulator").patches = []; }), "patches", /mock-board-simulator\.js:\d+ assigns G\.store\.scenario \(through the alias store\)/, "the simulator's call-time swap of G.store.scenario with its declaration removed");
  expectBreach(tweak((m, mod) => { mod("roadmap-bootstrap").hooks = ["board:rendered"]; }), "hooks", /00-roadmap-bootstrap\.js subscribes to "drills:rendered" but its manifest entry does not list it/, "a subscription missing from \"hooks\"");
  expectBreach(tweak((m) => { m.core.extensionPoints.push("home:rendered"); }), "hooks", /core\.extensionPoints lists "home:rendered" but src\/index\.html never runs it/, "an extension point core does not run");
  expectBreach(tweak((m, mod) => { mod("opsec-guard").provides.push("G.opsecGuard.sanitizeInput"); }), "provides", /05-opsec-guard\.js says it provides G\.opsecGuard\.sanitizeInput, but that does not exist/, "a provided name that no longer exists");
  expectBreach(tweak((m, mod) => { mod("pt-planner").provides.push("G.board.render"); }), "provides", /pt-planner\.js says it provides G\.board\.render, but core is what defines it/, "a provided name that belongs to core");
  expectBreach(tweak((m, mod) => { mod("opsec-guard").provides = ["G.opsecGuard.listWhat"]; }), "guard-provides", /recite-user-texts\.js:\d+ guards G\.opsecGuard\.screen, which belongs to src\/app-modules\/05-opsec-guard\.js .* does not list G\.opsecGuard\.screen under "provides"/, "a guarded module API missing from \"provides\"");
  expectBreach(tweak((m, mod) => { mod("pt-planner").routes = ["#/pt-plan", "#/no-such-screen"]; }), "routes", /pt-planner\.js lists the route #\/no-such-screen, which is not registered/, "a route that is not registered");
  expectBreach(tweak((m, mod) => { mod("pt-planner").routes = []; }), "routes", /the route #\/pt-plan is drawn by src\/app-modules\/pt-planner\.js .* does not list it/, "a module-drawn route missing from \"routes\"");
  expectBreach(tweak((m, mod) => { mod("team-training").routes.push("#/board"); }), "routes", /team-training\.js lists the route #\/board, but that route's render .* does not call into this module/, "a route claimed by the wrong module");
  expectBreach(tweak((m, mod) => { mod("pt-planner").storageKeys = ["prt:plan:v1"]; }), "storage", /pt-planner\.js:\d+ writes the storage key "pt:history:v1" but the module's manifest entry does not declare it/, "a written key missing from \"storageKeys\"");
  expectBreach(tweak((m, mod) => { mod("calendar").storageKeys.push("guidon:calendar:v0"); }), "storage", /calendar\.js declares the storage key "guidon:calendar:v0" but never writes it/, "a declared key nothing writes");
  expectBreach(tweak((m, mod) => { mod("recite-user-texts").clearsKeys = ["recite:*"]; }), "storage", /recite-user-texts\.js:\d+ deletes the storage key "recall-ladder:\*"/, "a deleted key missing from \"clearsKeys\"");
  expectBreach(tweak((m, mod) => { mod("leader").requires = []; }), "requires", /leader\.js uses G\.opsecGuard[.\w]*, which src\/app-modules\/05-opsec-guard\.js provides, but declares "opsec-guard" under neither/, "a dependency missing from \"requires\"");
  expectBreach(tweak((m) => { m.core.optionalApis.push({ name: "G.store.settings", why: "planted: it is always there" }); }), "optional-stale", /G\.store\.settings is listed under optionalApis .* but it is a function in every build/, "an optional API that exists everywhere");
  expectBreach(tweak((m) => { m.core.optionalApis.push({ name: "G.contract.plantedOptionalThatIsMissingEverywhere", why: "planted: nothing guards it" }); }), "optional-stale", /plantedOptionalThatIsMissingEverywhere is listed under optionalApis \(core\) but no guarded call/, "an optional API nothing guards");
}

rmSync(scratch, { recursive: true, force: true });
console.log(fails === 0 ? "\nMODULE CONTRACT: all passed" : `\nMODULE CONTRACT: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
