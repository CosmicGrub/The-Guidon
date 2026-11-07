/**
 * Proves the colour-contrast gate (tools/test-contrast-full.mjs) can FAIL.
 *
 * Why this exists: the sweep it guards once ended in `process.exit(0)` whatever
 * it found, and went on reporting "violations: 0" for months while the default
 * theme had real misses (2026-11 audit). A gate is only worth having if
 * something notices the day it stops being able to say no. This suite runs the
 * real gate, as a child process, three ways, on a deliberately narrow slice
 * (2 themes x 2 screens, no interaction states - a few seconds each):
 *
 *   1. PLANTED: a scratch copy of the built app with THREE defects in ONE
 *      theme: its secondary text colour made nearly invisible, a real label
 *      given the same colour as its own background (axe files that as
 *      "incomplete / equalRatio", and an earlier gate waved it through as
 *      deliberately hidden), and a real heading set in 30px #777 over a
 *      black-to-white gradient (fine at both ends, unreadable in the middle,
 *      which only sampling BETWEEN a gradient's stops can see). The gate must
 *      exit 1, must name that theme, must NOT blame the untouched theme, and
 *      must have caught the miss every way it can see text: axe's own verdict,
 *      the resolver for text over a gradient, the equal-colour label and the
 *      mid-gradient grey.
 *   2. HONEST: the same slice of the real, unmodified app. The gate must exit 0
 *      - a gate that cries wolf is as useless as one that never speaks.
 *   3. CI GUARD: narrowing the sweep with the GUIDON_CONTRAST_* variables is for
 *      working on the gate, never for CI; under CI=true it must refuse (exit 1).
 *
 * If someone turns the gate's exit code back into a constant, weakens the
 * canaries, stops it applying themes through the app, or drops the resolver,
 * run 1 stops exiting 1 (or stops naming both paths) and this suite fails.
 *
 * The scratch copy lives in the OS temp folder and is removed afterwards. The
 * built app's PDF folder is not copied (the gate never opens it).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, ok, bad, finish } from "./testkit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const GATE = path.join(HERE, "test-contrast-full.mjs");
const TIMEOUT_MS = 300000;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guidon-contrast-gate-"));
const SLICE = { GUIDON_CONTRAST_THEMES: "sepia-study,night-vision", GUIDON_CONTRAST_ROUTES: "#/home,#/settings", GUIDON_CONTRAST_STATES: "none" };

function runGate(extraEnv, label) {
  const env = { ...process.env, ...SLICE, ...extraEnv };
  if (!("CI" in extraEnv)) delete env.CI; // the slice variables are refused under CI; this suite sets CI itself where it means it
  const r = spawnSync(process.execPath, [GATE], { env, encoding: "utf8", timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.error) bad(`${label}: the gate could not be run: ${r.error.message}`);
  return { status: r.status, out };
}

try {
  /* ---- the scratch copy, with the planted defect ---- */
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
  const css = [
    "html[data-theme=\"sepia-study\"]{--text-dim:#cbbd9f !important;--text-2:#cbbd9f !important}",
    "html[data-theme=\"sepia-study\"] .last-backup-status{color:#f7f1e6 !important;background:#f7f1e6 !important}",
    "html[data-theme=\"sepia-study\"] .eyebrow{color:#777 !important;font-size:30px !important;font-weight:400 !important;background-image:linear-gradient(90deg,#000,#fff) !important}",
  ].join("\n");
  const planted = html.slice(0, close) + "\n" + css + "\n" + html.slice(close);
  fs.writeFileSync(indexPath, planted);

  /* ---- 1) planted ---- */
  const bad1 = runGate({ GUIDON_WEB_DIR: copy, GUIDON_CONTRAST_REPORT: path.join(scratch, "planted.json") }, "planted run");
  check(bad1.status === 1, "PLANTED: the gate exits 1 when a theme has unreadable text", `PLANTED: the gate exited ${bad1.status} (expected 1) - it can no longer fail. Tail: ${bad1.out.slice(-600)}`);
  check(/FAIL\s+\[sepia-study\]\s+\d+ colour-contrast miss/.test(bad1.out), "PLANTED: it names the broken theme (sepia-study)", () => "no 'FAIL [sepia-study] ... colour-contrast miss' line in:\n" + bad1.out.slice(-1200));
  check(!/FAIL\s+\[night-vision\]/.test(bad1.out) && /PASS\s+\[night-vision\] no colour-contrast miss/.test(bad1.out), "PLANTED: it does not blame the untouched theme (night-vision stays clean)", () => "night-vision was blamed or not judged:\n" + bad1.out.slice(-1200));
  check(/x\d+\s+axe\s+"/.test(bad1.out), "PLANTED: it caught text axe decides itself (a verdict straight from axe)", () => "no axe-decided miss in:\n" + bad1.out.slice(-1200));
  check(/x\d+\s+resolved:bg(?:Gradient|Image)/.test(bad1.out), "PLANTED: it caught text axe cannot decide (over a gradient or image, resolved by the sweep)", () => "no resolved miss in:\n" + bad1.out.slice(-1200));
  check(/last-backup-status[^\n]*\b1:1 \(needs 4\.5\)[^\n]*resolved:equalRatio/.test(bad1.out), "PLANTED: a label with the same colour as its background is reported as a 1:1 miss (not waved through as 'deliberately hidden')", () => "no 1:1 equalRatio miss for .last-backup-status in:\n" + bad1.out.slice(-1800));
  check(/eyebrow[^\n]*\(needs 3\)[^\n]*resolved:bgGradient/.test(bad1.out), "PLANTED: 30px #777 over a black-to-white gradient is reported (the grey in the middle, not just the two ends)", () => "no mid-gradient miss for .eyebrow in:\n" + bad1.out.slice(-1800));
  check(/the planted canaries were reported/.test(bad1.out) && !/FAIL\s+.*misjudged its own canaries/.test(bad1.out), "PLANTED: the gate's own canaries were reported on every measurement", () => "canary line missing or failing:\n" + bad1.out.slice(-1200));

  /* ---- 2) honest ---- */
  const good = runGate({ GUIDON_CONTRAST_REPORT: path.join(scratch, "honest.json") }, "honest run");
  check(good.status === 0, "HONEST: the same slice of the real app passes (exit 0)", `HONEST: the gate exited ${good.status} on the unmodified app. Tail: ${good.out.slice(-1500)}`);
  check(/PARTIAL RUN/.test(good.out), "HONEST: a narrowed run says plainly that it is not the gate", "no PARTIAL RUN notice");

  /* ---- 3) CI guard ---- */
  const guard = runGate({ CI: "true" }, "CI guard run");
  check(guard.status === 1 && /not allowed in CI/.test(guard.out), "CI GUARD: narrowing the sweep under CI=true is refused (exit 1)", `CI GUARD: exit ${guard.status}; ${guard.out.slice(-400)}`);
} catch (e) {
  bad("the suite could not run: " + e.message);
} finally {
  try { fs.rmSync(scratch, { recursive: true, force: true }); ok("scratch copy removed"); } catch (e) { bad("could not remove the scratch folder " + scratch + ": " + e.message); }
}

await finish("CONTRAST-FULL-GATE");
