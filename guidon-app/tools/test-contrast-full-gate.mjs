/**
 * Proves the colour-contrast gate (tools/test-contrast-full.mjs) can FAIL.
 *
 * Why this exists: the sweep it guards once ended in `process.exit(0)` whatever
 * it found, and went on reporting "violations: 0" for months while the default
 * theme had real misses (2026-11 audit). A gate is only worth having if
 * something notices the day it stops being able to say no. This suite runs the
 * real gate, as a child process, on deliberately narrow slices (2 themes x 3
 * screens, no interaction states; one screen's tabs), a few seconds each:
 *
 *   1. PLANTED: a scratch copy of the built app with defects in ONE theme: its
 *      secondary text colour made nearly invisible, a real label given the same
 *      colour as its own background (axe files that as "incomplete / equalRatio",
 *      and an earlier gate waved it through as deliberately hidden), a real
 *      heading set in 30px #777 over a black-to-white gradient (fine at both
 *      ends, unreadable in the middle), white text on white with an opaque
 *      gradient over only a 4px bar of its box (the colour beneath must stay a
 *      candidate), and a pale placeholder (drawn by the browser, never seen by
 *      axe). The gate must exit 1, must name that theme, must NOT blame the
 *      untouched theme, and must have caught each miss the way only the right
 *      code path can.
 *   2. HONEST: the same slice of the real, unmodified app. The gate must exit 0
 *      - a gate that cries wolf is as useless as one that never speaks.
 *   3. CI GUARD: narrowing the sweep with the GUIDON_CONTRAST_* variables is for
 *      working on the gate, never for CI; under CI=true it must refuse (exit 1).
 *   4. A DEFECT BEHIND A TAB: the tab suite, on the Money screen, with a defect
 *      that only shows in its Budget tab. The default-tab sweep never sees it.
 *   5. WIRING: every suite, and every shard of the tab walk, is run by `npm test`; each shard has a CI chunk to itself; the chunk step has a timeout
 *      (the gate is split into suites that CI runs in separate chunks; a suite
 *      nobody runs guards nothing).
 *   6. MUTANTS OF THE GATE: copies of the gate itself, each with one behaviour
 *      cut out - the partial-coverage rule, the placeholder pass, the
 *      form-control value path, the opening of every closed <details>, the tab
 *      walk - must each exit 1. A gate whose canaries stop biting is caught here.
 *
 * If someone turns the gate's exit code back into a constant, weakens the
 * canaries, stops it applying themes through the app, or drops the resolver,
 * run 1 stops exiting 1 (or stops naming every path) and this suite fails.
 *
 * The scratch copies live in the OS temp folder and are removed afterwards. The
 * built app's PDF folder is not copied (the gate never opens it).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check, ok, bad, finish } from "./testkit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const GATE = path.join(HERE, "test-contrast-full.mjs");
const TIMEOUT_MS = 300000;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guidon-contrast-gate-"));
const SLICE = { GUIDON_CONTRAST_THEMES: "sepia-study,night-vision", GUIDON_CONTRAST_ROUTES: "#/home,#/settings,#/train", GUIDON_CONTRAST_STATES: "none" };
const TAB_SLICE = { GUIDON_CONTRAST_THEMES: "sepia-study,night-vision", GUIDON_CONTRAST_ROUTES: "#/money" };
const MUTANT_SLICE = { GUIDON_CONTRAST_THEMES: "night-vision", GUIDON_CONTRAST_ROUTES: "#/home", GUIDON_CONTRAST_STATES: "none" };

function runGate(gateFile, args, extraEnv, label) {
  const env = { ...process.env, ...extraEnv };
  if (!("CI" in extraEnv)) delete env.CI; // the slice variables are refused under CI; this suite sets CI itself where it means it
  const r = spawnSync(process.execPath, [gateFile, ...args], { env, encoding: "utf8", timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.error) bad(`${label}: the gate could not be run: ${r.error.message}`);
  return { status: r.status, out };
}

/* A copy of the gate with ONE behaviour cut out. `from` must occur exactly once, so a refactor of the gate that moves the line
   fails here loudly instead of silently testing nothing. Imports are pointed back at the real tools folder. */
function mutant(name, from, to) {
  const src = fs.readFileSync(GATE, "utf8");
  const n = src.split(from).length - 1;
  if (n !== 1) { bad(`mutant ${name}: the line to cut out occurs ${n} times in the gate (expected exactly 1): ${from.slice(0, 80)}`); return null; }
  let out = src.replace(from, () => to);
  out = out.replace("from \"./testkit.mjs\"", () => `from ${JSON.stringify(pathToFileURL(path.join(HERE, "testkit.mjs")).href)}`);
  out = out.replace("new URL(import.meta.resolve(\"axe-core/axe.min.js\"))", () => JSON.stringify(path.join(APP, "node_modules", "axe-core", "axe.min.js")));
  const file = path.join(scratch, `gate-mutant-${name}.mjs`);
  fs.writeFileSync(file, out);
  return file;
}

try {
  /* ---- the scratch copy, with the planted defects ---- */
  const src = path.join(APP, "web");
  if (!fs.existsSync(path.join(src, "index.html"))) throw new Error("web/index.html does not exist - build first (npm run icons && npm run build)");
  const copy = path.join(scratch, "web");
  fs.cpSync(src, copy, { recursive: true, filter: (p) => path.relative(src, p).split(path.sep)[0] !== "docs" });
  const indexPath = path.join(copy, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const close = html.indexOf("</style>");
  check(close > 0, "fixture: found the main stylesheet in the built app to plant a defect in", "no </style> in web/index.html");
  // Appended as LATER rules so they do not depend on the theme block's current values.
  //  - Sepia Study's secondary text colour becomes a pale tan on its cream panels (about 1.5:1).
  //  - the "backed up" line gets the colour of its own background: text you cannot see at all.
  //  - every section eyebrow becomes 30px #777 over black-to-white: 4.7:1 on black, 4.5:1 on white, 1:1 in the middle.
  //  - the Settings theme panel's label becomes white on white with an opaque black gradient over a 4px bar only: 1:1 for most of the box.
  //  - every real placeholder becomes pale (the gate's own canary fields are left alone: they set their own).
  //  - Money's Budget amounts become pale on their panel (this shows only in the Budget tab).
  const css = [
    "html[data-theme=\"sepia-study\"]{--text-dim:#cbbd9f !important;--text-2:#cbbd9f !important}",
    "html[data-theme=\"sepia-study\"] .last-backup-status{color:#f7f1e6 !important;background:#f7f1e6 !important}",
    "html[data-theme=\"sepia-study\"] .eyebrow{color:#777 !important;font-size:30px !important;font-weight:400 !important;background-image:linear-gradient(90deg,#000,#fff) !important}",
    "html[data-theme=\"sepia-study\"] #settings-theme-panel > label{color:#fff !important;background:#fff linear-gradient(#000,#000) no-repeat 0 100%/100% 4px !important}",
    "html[data-theme=\"sepia-study\"] input:not([id^=\"cg-canary\"])::placeholder, html[data-theme=\"sepia-study\"] textarea:not([id^=\"cg-canary\"])::placeholder{color:#d8cfbf !important;opacity:1 !important}",
    "html[data-theme=\"sepia-study\"] .fin-budget-amt{color:#e3d8be !important}",
  ].join("\n");
  const planted = html.slice(0, close) + "\n" + css + "\n" + html.slice(close);
  fs.writeFileSync(indexPath, planted);

  /* ---- 1) planted ---- */
  const plantedReport = path.join(scratch, "planted.json");
  const bad1 = runGate(GATE, ["--suite=screens"], { ...SLICE, GUIDON_WEB_DIR: copy, GUIDON_CONTRAST_REPORT: plantedReport }, "planted run");
  /* the miss rows are read from the gate's JSON report (the console only prints the first 40 per theme) */
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(plantedReport, "utf8")).misses; } catch (e) { bad("PLANTED: the gate wrote no readable report: " + e.message); }
  const find = (theme, re, via, extra) => rows.find((r) => r.theme === theme && re.test(r.selector) && via.test(r.via) && (!extra || extra(r)));
  check(bad1.status === 1, "PLANTED: the gate exits 1 when a theme has unreadable text", `PLANTED: the gate exited ${bad1.status} (expected 1) - it can no longer fail. Tail: ${bad1.out.slice(-600)}`);
  check(/FAIL\s+\[sepia-study\]\s+\d+ colour-contrast miss/.test(bad1.out), "PLANTED: it names the broken theme (sepia-study)", () => "no 'FAIL [sepia-study] ... colour-contrast miss' line in:\n" + bad1.out.slice(-1200));
  check(!/FAIL\s+\[night-vision\]/.test(bad1.out) && /PASS\s+\[night-vision\] no colour-contrast miss/.test(bad1.out) && !rows.some((r) => r.theme === "night-vision"), "PLANTED: it does not blame the untouched theme (night-vision stays clean)", () => "night-vision was blamed or not judged:\n" + bad1.out.slice(-1200));
  check(find("sepia-study", /./, /^axe$/), "PLANTED: it caught text axe decides itself (a verdict straight from axe)", () => "no axe-decided miss in the report: " + JSON.stringify(rows.slice(0, 3)));
  check(find("sepia-study", /./, /^resolved:bg(?:Gradient|Image)/), "PLANTED: it caught text axe cannot decide (over a gradient or image, resolved by the sweep)", "no resolved miss in the report");
  check(find("sepia-study", /last-backup-status/, /^resolved:equalRatio/, (r) => r.ratio === 1 && r.need === 4.5), "PLANTED: a label with the same colour as its background is reported as a 1:1 miss (not waved through as 'deliberately hidden')", "no 1:1 equalRatio miss for .last-backup-status");
  check(find("sepia-study", /eyebrow/, /^resolved:bgGradient/, (r) => r.need === 3), "PLANTED: 30px #777 over a black-to-white gradient is reported (the grey in the middle, not just the two ends)", "no mid-gradient miss for .eyebrow");
  check(find("sepia-study", /settings-theme-panel > label/, /^resolved:bgGradient/, (r) => r.ratio === 1), "PLANTED: white text whose opaque gradient covers only a 4px bar of the box is reported as 1:1 (the white beneath the gradient stays a candidate)", "no partial-coverage miss for the theme panel's label");
  check(find("sepia-study", /::placeholder$/, /^placeholder/, (r) => r.route === "#/train"), "PLANTED: a pale placeholder is reported (it is drawn by the browser, axe never looks at it)", "no placeholder miss on #/train");
  check(/the planted canaries were reported/.test(bad1.out) && !/FAIL\s+.*misjudged its own canaries/.test(bad1.out), "PLANTED: the gate's own canaries were reported on every measurement", () => "canary line missing or failing:\n" + bad1.out.slice(0, 1500));

  /* ---- 2) honest ---- */
  const good = runGate(GATE, ["--suite=screens"], { ...SLICE, GUIDON_CONTRAST_REPORT: path.join(scratch, "honest.json") }, "honest run");
  check(good.status === 0, "HONEST: the same slice of the real app passes (exit 0)", `HONEST: the gate exited ${good.status} on the unmodified app. Tail: ${good.out.slice(-1500)}`);
  check(/PARTIAL RUN/.test(good.out), "HONEST: a narrowed run says plainly that it is not the gate", "no PARTIAL RUN notice");

  /* ---- 3) CI guard ---- */
  const guard = runGate(GATE, ["--suite=screens"], { ...SLICE, CI: "true" }, "CI guard run");
  check(guard.status === 1 && /not allowed in CI/.test(guard.out), "CI GUARD: narrowing the sweep under CI=true is refused (exit 1)", `CI GUARD: exit ${guard.status}; ${guard.out.slice(-400)}`);

  /* ---- 4) a defect that shows only behind a tab ---- */
  const tabs = runGate(GATE, ["--suite=tabs"], { ...TAB_SLICE, GUIDON_WEB_DIR: copy, GUIDON_CONTRAST_REPORT: path.join(scratch, "tabs.json") }, "tab run");
  check(tabs.status === 1, "TABS: the gate exits 1 for a defect that only shows in a Money tab (the default tab is fine)", `TABS: exit ${tabs.status} (expected 1). Tail: ${tabs.out.slice(-800)}`);
  check(/fin-budget-amt[^\n]*in tabs:#\/money > Budget/.test(tabs.out), "TABS: it names the selector and the tab that holds it (#/money > Budget)", () => "no '.fin-budget-amt ... in tabs:#/money > Budget' line in:\n" + tabs.out.slice(-1800));
  check(/PASS\s+\[night-vision\] no colour-contrast miss/.test(tabs.out), "TABS: the untouched theme stays clean through every Money tab", () => "night-vision was blamed or not judged in the tab run:\n" + tabs.out.slice(-1200));
  check(/\[tabs\] #\/money: \d+ tab states reached/.test(tabs.out), "TABS: the walk reports how many Money tab states it reached (a floor applies to it even in a narrowed run)", () => "no per-screen tab floor line in:\n" + tabs.out.slice(-1200));

  /* ---- 5) wiring: every suite, and every shard of it, is run by npm test, each in a chunk of its own where it is heavy ---- */
  const list = runGate(GATE, ["--list-suites"], {}, "list suites");
  let suites = [];
  try { suites = JSON.parse(list.out.trim().split("\n").pop()); } catch (e) { bad("WIRING: --list-suites did not print a JSON list: " + list.out.slice(0, 200)); }
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8"));
  const runner = pkg.scripts.test || "";
  const mine = Object.entries(pkg.scripts).filter(([, v]) => /tools\/test-contrast-full\.mjs/.test(v));
  check(suites.length >= 2, `WIRING: the gate lists its suites (${suites.join(", ")})`, "WIRING: --list-suites listed fewer than two suites");
  for (const s of suites) {
    const scripts = mine.filter(([, v]) => (v.match(/--suite=(\w+)/) || [])[1] === s);
    const shards = scripts.map(([name, v]) => ({ name, k: +((v.match(/--shard=(\d+)\//) || [])[1] || 1), n: +((v.match(/--shard=\d+\/(\d+)/) || [])[1] || 1) }));
    const n = shards.length ? shards[0].n : 0;
    const covered = [...new Set(shards.filter((x) => x.n === n).map((x) => x.k))].sort((a, b) => a - b);
    check(shards.length > 0 && shards.every((x) => x.n === n) && covered.length === n && covered.every((k, i) => k === i + 1) && shards.length === n,
      `WIRING: suite "${s}" is wired in package.json as ${n === 1 ? "one script" : "shards 1..." + n} (${shards.map((x) => x.name).join(", ")})`,
      `WIRING: suite "${s}" is not fully wired in package.json: scripts [${shards.map((x) => x.name + " " + x.k + "/" + x.n).join(", ")}] do not cover every screen exactly once`);
    for (const x of shards) check(new RegExp("(^|\\s)" + x.name + "(\\s|$)").test(runner), `WIRING: npm test runs ${x.name}`, `WIRING: ${x.name} is a script but is not in npm test's run-parallel list - CI would never run that part of the gate`);
  }
  check(!mine.some(([, v]) => !/--suite=/.test(v)), "WIRING: no package.json script runs the gate without --suite (a script that runs both would double the time in one CI chunk)", "WIRING: a package.json script runs tools/test-contrast-full.mjs without --suite=");
  /* the shards are heavy: no two parts of the gate may share a CI chunk (a chunk runs its suites at the same time on a 2-vCPU runner) */
  const ci = fs.readFileSync(path.join(APP, "..", ".github", "workflows", "ci.yml"), "utf8");
  const chunks = [...ci.matchAll(/tests: "([^"]*)"/g)].map((m) => m[1].trim().split(/\s+/));
  const gateNames = mine.map(([n]) => n);
  for (const name of gateNames) {
    const chunk = chunks.find((c) => c.includes(name));
    const others = chunk ? chunk.filter((x) => x !== name && gateNames.includes(x)) : [];
    check(chunk && others.length === 0, `WIRING: ${name} shares its CI chunk with no other part of the gate`, `WIRING: ${name} ${chunk ? "shares its CI chunk with " + others.join(", ") : "is in no CI chunk"} - the shards must not share a runner`);
  }
  check(/timeout-minutes: 12\s*\n\s*env:\s*\n\s*ARDUINOJSON_DIR/.test(ci), "WIRING: the 'Run test chunk' step has its own timeout, shorter than the job's, so a hung chunk fails fast", "WIRING: the 'Run test chunk' step has no timeout-minutes of its own");

  /* ---- 6) mutants of the gate itself: each cut-out behaviour must make the gate exit 1 ---- */
  const MUTANTS = [
    { name: "partial-coverage", args: ["--suite=screens"], env: MUTANT_SLICE, expect: /cg-canary-top-partial-half/,
      from: "cands = prune(whole ? next : cands.concat(next));", to: "cands = prune(next);", why: "an opaque gradient that covers only part of the box hides the colour beneath it again" },
    { name: "placeholders", args: ["--suite=screens"], env: MUTANT_SLICE, expect: /cg-canary-top-ph\b/,
      from: "document.querySelectorAll(\"input[placeholder], textarea[placeholder]\").forEach(", to: "[].forEach(", why: "placeholders are no longer measured" },
    { name: "form-values", args: ["--suite=screens"], env: MUTANT_SLICE, expect: /cg-canary-top-input-eq/,
      from: "if (t === \"INPUT\" || t === \"TEXTAREA\") return String(el.value || \"\").trim();", to: "", why: "the text in a form control is no longer read" },
    { name: "details", args: ["--suite=screens"], env: MUTANT_SLICE, expect: /cg-canary-details-text/,
      from: "d.open = true; if (!d.hasAttribute(\"data-cg-canary\")) opened++;", to: "if (!d.hasAttribute(\"data-cg-canary\")) opened++;", why: "closed <details> are no longer opened" },
    { name: "allowlist-route", args: ["--suite=screens"], env: MUTANT_SLICE, expect: /names no real screen/,
      from: "const ALLOWLIST = [];", to: "const ALLOWLIST = [{ theme: \"night-vision\", route: \"#/no-such-screen\", selector: \"span\", reason: \"a generic selector must never excuse a whole theme\" }];", why: "an allowlist entry that names no real screen (a bare selector such as span) is refused" },
    { name: "stall", args: ["--suite=screens"], env: { ...MUTANT_SLICE, GUIDON_CONTRAST_STALL_SEC: "6" }, expect: /the sweep stalled[^\n]*last step that finished: profile:#\/home[\s\S]*starting over, once[\s\S]*the sweep stalled/,
      from: "const r = await page.evaluate(MEASURE, { id: t.id, withCanary: true, RESOLVABLE, host, only });", to: "await new Promise(() => {}); const r = await page.evaluate(MEASURE, { id: t.id, withCanary: true, RESOLVABLE, host, only });", why: "a browser call that never returns fails after the stall limit with the last step named, instead of waiting for the CI job limit" },
    { name: "dead-app", args: ["--suite=screens"], env: { ...MUTANT_SLICE, GUIDON_CONTRAST_ROUTES: "#/home,#/settings,#/train,#/money,#/health" }, expect: /4 screens or states in a row could not be reached[\s\S]*starting over, once[\s\S]*4 screens or states in a row could not be reached/,
      from: "signatures.profile.set(hash, prep.sig);", to: "throw new Error(\"simulated: the page did not answer\"); signatures.profile.set(hash, prep.sig);", why: "four screens in a row that cannot be reached stop the run at once and say so, instead of waiting out every remaining timeout" },
    { name: "tab-walk", args: ["--suite=tabs"], env: TAB_SLICE, expect: /tab states reached/,
      from: "const TAB_SEL = \"[role=\\\"tab\\\"], .tabbar .tab, .segmented button, button[aria-pressed], button[aria-selected], .chip, .list-detail-row\";", to: "const TAB_SEL = \"#no-such-control\";", why: "the tab walk finds no controls" },
  ];
  for (const m of MUTANTS) {
    const file = mutant(m.name, m.from, m.to);
    if (!file) continue;
    const r = runGate(file, m.args, { ...m.env, GUIDON_CONTRAST_REPORT: path.join(scratch, `mutant-${m.name}.json`) }, `mutant ${m.name}`);
    check(r.status === 1 && m.expect.test(r.out), `MUTANT ${m.name}: with ${m.why}, the gate exits 1 and says why`, () => `MUTANT ${m.name}: exit ${r.status}; expected a failure matching ${m.expect}. Tail:\n${r.out.slice(-1500)}`);
  }
} catch (e) {
  bad("the suite could not run: " + e.message);
} finally {
  try { fs.rmSync(scratch, { recursive: true, force: true }); ok("scratch copies removed"); } catch (e) { bad("could not remove the scratch folder " + scratch + ": " + e.message); }
}

await finish("CONTRAST-FULL-GATE");
