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
  const bgOf = (el) => {
    // Every plausible backdrop for the element's text: gradient color stops
    // (backgroundColor is transparent for gradients — the .btn.primary lesson)
    // plus the first opaque composited backgroundColor up the ancestor chain.
    // The caller checks against ALL candidates and keeps the worst ratio.
    const candidates = [];
    let acc = null;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") {
        const stops = cs.backgroundImage.match(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g) || [];
        for (const st of stops) {
          const c = parse(st);
          if (c && c[3] >= 0.5) candidates.push(c); // ignore near-transparent washes
        }
      }
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) {
        if (!acc) acc = c;
        else {
          const a = acc[3];
          acc = [acc[0] * a + c[0] * (1 - a), acc[1] * a + c[1] * (1 - a), acc[2] * a + c[2] * (1 - a), a + c[3] * (1 - a)];
        }
        if (acc[3] >= 0.999) break;
      }
      if (candidates.length && cs.backgroundImage !== "none") break; // gradient covers what's behind
    }
    candidates.push(acc || [255, 255, 255, 1]);
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

if (problems.length || formsProblems.length || boardProblems.length) {
  for (const p of [...problems, ...formsProblems, ...boardProblems].slice(0, 40)) console.log("        " + p);
}

noise.length === 0 ? ok("no page errors during sweep") : bad(noise.length + " page errors; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `CONTRAST: ${fails} FAILURE(S)` : "CONTRAST: all passed"));
process.exit(fails ? 1 : 0);
