/**
 * Text legibility across every theme.
 *
 * The user-facing contract: "all text on the app is readable and perfectly
 * legible despite any themes and color schemes applied." This walks all 24
 * themes and measures real WCAG contrast ratios on the surfaces that have
 * bitten us before (the Train text-console and CYOA scene banner were
 * hardcoded-dark until session 20) plus the everyday chrome: nav, buttons,
 * dim text, board card, grade labels.
 *
 * Thresholds: 4.5:1 for body-size text (WCAG AA), 3:1 for large text,
 * accent labels and icon-bearing controls (AA large / non-text minimums).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const noise = [];
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1100);
// The app crossfades colors on theme change. getComputedStyle returns the
// MID-TRANSITION interpolated value (serialized as oklab), which made early
// versions of this suite report phantom failures. Kill all transitions so
// every measurement is the steady-state value.
await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1100);

// Probe: the trainer surfaces, built from the app's own classes so the real
// stylesheet (including the color-mix token derivations) is what's measured.
await page.evaluate(() => {
  const d = document.createElement("div");
  d.className = "probe-contrast";
  d.innerHTML =
    '<div class="mode-text"><div class="console">' +
    '<div class="sys">SCENARIO BEAT</div>' +
    '<div class="prompt">Prompt paragraph text the Soldier must read.</div>' +
    '<button class="choice"><b>A.</b> A choice the Soldier can pick</button>' +
    "</div></div>" +
    '<div class="mode-cyoa"><div class="scene-banner"><span class="label">SCENE LABEL</span></div></div>' +
    // The forms view restyles primary buttons (amber text) — probe the rule
    // without having to open a real form.
    '<div class="forms-view"><button class="btn primary">Fill this form</button></div>' +
    // Flat swatches approximating the banner's gradient layers, so the label
    // can be checked against both the base wash and the amber stripe.
    '<div class="probe-banner-base" style="background: color-mix(in srgb, var(--cyan) 14%, var(--panel))"></div>' +
    '<div class="probe-banner-stripe" style="background: color-mix(in srgb, var(--amber) 5%, color-mix(in srgb, var(--cyan) 14%, var(--panel)))"></div>';
  document.body.appendChild(d);
});

// All 24 theme ids, kept in sync with html[data-theme] selectors in the source.
const THEMES = ["blackout","bone-neutral","clay-warm","desert-cadence","field-manual","graphite-calm",
      "harbor-mid","ink-paper","nautical-dusk","night-vision","overcast-glare","parade-rest",
      "parchment-read","pine-dusk","range-red","sandstone-sun","sepia-study","signal-amber",
      "slate-focus","slate-quiet","squadron-blue","subdued","topographic","umber-lamp"];

// [selector, minimum ratio, what it is]
const SAMPLES = [
  [".probe-contrast .console .prompt", 4.5, "Train console prompt"],
  [".probe-contrast .console .choice", 4.5, "Train console choice"],
  [".probe-contrast .console .sys", 3.0, "Train console system line"],
  ["#route .text-dim, #route .hint, #route small, .text-dim", 3.0, "dim/secondary text"],
  [".nav button, nav button", 4.5, "nav label"],
  [".btn.primary", 4.5, "primary button"],
  [".probe-contrast .forms-view .btn.primary", 4.5, "forms primary button"],
  [".topbar-search-btn", 3.0, "topbar icon control"],
];
// Board view adds these:
const BOARD_SAMPLES = [
  [".qz-front", 4.5, "board card front"],
  [".qz-grade-label", 4.5, "grade button label"],
];
// Search and Settings were never swept before a 49-agent audit (session 51)
// found nine genuine sub-AA failures here: TYPE_COLOR search-chip labels and
// the .fin-h section heading used raw --cyan/--violet/--red/--amber as direct
// text color instead of the codebase's own --ink-* blend (built specifically
// for this problem, but these two spots never got migrated to it), plus a
// literal rgba(255,176,32,...) active-chip background that assumed "amber"
// is always orange - wrong in squadron-blue, which reassigns --amber to blue.
const SEARCH_SAMPLES = [
  // TYPES order in views.search is [all, scenario, board, doctrine, lesson, resource] -
  // .search-filters renders them as consecutive sibling buttons in that order.
  [".search-filters .search-chip:nth-of-type(1)", 4.5, "search filter chip (All, active)"],
  [".search-filters .search-chip:nth-of-type(2)", 4.5, "search filter chip (Scenarios)"],
  [".search-filters .search-chip:nth-of-type(3)", 4.5, "search filter chip (Board Q)"],
  [".search-filters .search-chip:nth-of-type(4)", 4.5, "search filter chip (Doctrine)"],
  [".search-filters .search-chip:nth-of-type(5)", 4.5, "search filter chip (Lessons)"],
  [".search-filters .search-chip:nth-of-type(6)", 4.5, "search filter chip (Resources)"],
];
const SETTINGS_SAMPLES = [
  [".fin-h", 3.0, "section heading (.fin-h)"],
];

const measure = (samples) => page.evaluate((samples) => {
  const lum = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    let m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    m = s.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
    if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    return null;
  };
  const over = (top, bottom) => {
    const a = top[3];
    return [top[0]*a+bottom[0]*(1-a), top[1]*a+bottom[1]*(1-a), top[2]*a+bottom[2]*(1-a), a+bottom[3]*(1-a)];
  };
  const bgOf = (el) => {
    // Every plausible backdrop for the element's text, properly "over"-
    // composited: any translucent layer nearer the element gets blended
    // ONTO whatever's found further out (a gradient's color stops, or a
    // solid opaque backgroundColor) before being trusted as a candidate -
    // never used with its own alpha ignored. The caller checks against ALL
    // candidates and keeps the worst ratio.
    //
    // BUG #1 (found while auditing #/settings, session 51): this used to
    // always push a manufactured white fallback, even when the gradient-stop
    // walk above already found the real background - so near-white text on
    // a correctly high-contrast dark gradient panel got checked against a
    // bogus near-white "background" too, and worst() always keeps the lowest
    // ratio, so it silently reported ~1:1 failures that were actually fine.
    //
    // BUG #2 (found auditing session 51's broader sweep, via .res-crisis-h
    // reporting an impossible flat 1.00 ratio on all 24 themes regardless of
    // that theme's actual --red value): this broke out of the walk the
    // instant it found gradient stops, WITHOUT compositing a still-pending
    // translucent nearer-ancestor backgroundColor (e.g. a low-opacity accent
    // wash) against those stops first - then separately pushed that raw,
    // un-composited translucent color as if it were opaque. A translucent
    // wash's raw RGB channels can be far more saturated than what actually
    // renders once blended with what's behind it, manufacturing a phantom
    // "background" that doesn't reflect the real pixels.
    //
    // BUG #3 (found immediately after fixing #2, via .brand .mark reporting
    // ~1.5 on several themes where its OWN solid backgroundColor resolves the
    // walk on the very first iteration): the fix for #2 tracked resolution
    // via a separate boolean and only pushed the accumulated color when
    // resolution did NOT happen - meaning the one specific case of "resolved
    // via a fully-opaque solid backgroundColor" pushed nothing at all,
    // silently falling through to the plain white default. Now: acc is
    // always pushed if it holds anything, using it directly when already
    // fully opaque and compositing over white only for the genuinely
    // unresolved (ran out of ancestors mid-translucent) case.
    const candidates = [];
    let acc = null;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") {
        // Only substantial/opaque paint counts as "this gradient IS the
        // background" (e.g. .panel's cream-to-tan surface). A body-level
        // decorative glow like radial-gradient(..., rgba(56,214,224,.06),
        // transparent 60%) is NOT that - treating a 6%-alpha stop as if it
        // were solid manufactures a phantom saturated backdrop (caught via
        // the forms-primary-button probe reporting ~1:1 on nearly every
        // theme, impossible for an already-fixed, working element). Ignore
        // low-alpha stops and fall through to this same element's own
        // backgroundColor - the real base paint such a glow sits on top of.
        const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g) || [])
          .map(parse).filter((c) => c && c[3] >= 0.5);
        if (stops.length) {
          for (const c of stops) {
            const stopOpaque = [c[0], c[1], c[2], 1];
            candidates.push(acc ? over(acc, stopOpaque) : stopOpaque);
          }
          acc = null; // gradient is opaque paint; resolves everything behind it
          break;
        }
      }
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) {
        acc = acc ? over(acc, c) : c;
        if (acc[3] >= 0.999) break; // fully opaque - acc IS the resolved background
      }
    }
    if (acc) candidates.push(acc[3] >= 0.999 ? acc : over(acc, [255, 255, 255, 1]));
    if (!candidates.length) candidates.push([255, 255, 255, 1]);
    return candidates;
  };
  const ratio = (fg, bg) => {
    const l1 = lum(fg[0], fg[1], fg[2]), l2 = lum(bg[0], bg[1], bg[2]);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const worst = (fg, cands) => Math.min(...cands.map((c) => ratio(fg, c)));
  const out = [];
  for (const [sel, min, label] of samples) {
    const el = document.querySelector(sel);
    if (!el) { out.push({ sel, label, min, missing: "no element" }); continue; }
    const raw = getComputedStyle(el).color;
    const fg = parse(raw);
    if (!fg) { out.push({ sel, label, min, missing: "unparsed color: " + raw }); continue; }
    out.push({ sel, label, min, ratio: Math.round(worst(fg, bgOf(el)) * 100) / 100 });
  }
  // scene-banner label vs both gradient layers (flat approximations)
  const lab = document.querySelector(".probe-contrast .scene-banner .label");
  const base = document.querySelector(".probe-banner-base");
  const stripe = document.querySelector(".probe-banner-stripe");
  if (lab && base && stripe) {
    const fg = parse(getComputedStyle(lab).color);
    const r1 = ratio(fg, parse(getComputedStyle(base).backgroundColor));
    const r2 = ratio(fg, parse(getComputedStyle(stripe).backgroundColor));
    out.push({ sel: ".scene-banner .label", label: "CYOA scene label", min: 3.0, ratio: Math.round(Math.min(r1, r2) * 100) / 100 });
  }
  return out;
}, samples);

const problems = [];
for (const theme of THEMES) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(30);
  const rows = await measure(SAMPLES);
  for (const r of rows) {
    if (r.missing) problems.push(`${theme}: ${r.label} — ${r.missing}`);
    else if (r.ratio < r.min) problems.push(`${theme}: ${r.label} ${r.ratio}:1 < ${r.min}:1`);
  }
}
problems.length === 0
  ? ok(`24 themes x ${SAMPLES.length + 1} home/train surfaces all meet contrast minimums`)
  : bad(problems.length + " contrast problems; first: " + problems[0]);

const formsProblems = []; // folded into the main sweep via the probe

// Board view sweep
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1100);
const boardProblems = [];
for (const theme of THEMES) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(30);
  const rows = await measure(BOARD_SAMPLES);
  for (const r of rows) {
    if (r.missing) boardProblems.push(`${theme}: ${r.label} — ${r.missing}`);
    else if (r.ratio < r.min) boardProblems.push(`${theme}: ${r.label} ${r.ratio}:1 < ${r.min}:1`);
  }
}
boardProblems.length === 0
  ? ok("24 themes x board card + grade labels all meet contrast minimums")
  : bad(boardProblems.length + " board contrast problems; first: " + boardProblems[0]);

// Search view sweep
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(900);
const searchProblems = [];
for (const theme of THEMES) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(30);
  const rows = await measure(SEARCH_SAMPLES);
  for (const r of rows) {
    if (r.missing) searchProblems.push(`${theme}: ${r.label} — ${r.missing}`);
    else if (r.ratio < r.min) searchProblems.push(`${theme}: ${r.label} ${r.ratio}:1 < ${r.min}:1`);
  }
}
searchProblems.length === 0
  ? ok("24 themes x 6 search filter chips all meet contrast minimums")
  : bad(searchProblems.length + " search contrast problems; first: " + searchProblems[0]);

// Settings view sweep
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(900);
const settingsProblems = [];
for (const theme of THEMES) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(30);
  const rows = await measure(SETTINGS_SAMPLES);
  for (const r of rows) {
    if (r.missing) settingsProblems.push(`${theme}: ${r.label} — ${r.missing}`);
    else if (r.ratio < r.min) settingsProblems.push(`${theme}: ${r.label} ${r.ratio}:1 < ${r.min}:1`);
  }
}
settingsProblems.length === 0
  ? ok("24 themes x .fin-h section heading meet contrast minimums")
  : bad(settingsProblems.length + " settings contrast problems; first: " + settingsProblems[0]);

if (problems.length || formsProblems.length || boardProblems.length || searchProblems.length || settingsProblems.length) {
  for (const p of [...problems, ...formsProblems, ...boardProblems, ...searchProblems, ...settingsProblems].slice(0, 40)) console.log("        " + p);
}

noise.length === 0 ? ok("no page errors during sweep") : bad(noise.length + " page errors; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `CONTRAST: ${fails} FAILURE(S)` : "CONTRAST: all passed"));
process.exit(fails ? 1 : 0);
