/**
 * Forms Trainer contrast GATE: open every form, every tab, and FAIL on any
 * text a Soldier could not read.
 *
 * Why this exists (audit 2026-09, forms-invisible-text): the Article 31(b)
 * rights text on DA 2823/3881 and the DA 4856 counseling opener bullets
 * measured 1.04:1 and 1.08:1 in Field Manual, the theme every new install
 * starts in, because the styles named colour tokens no theme defines (--fg,
 * --muted) and the browser used a fixed pale fallback. Nothing caught it:
 *   - tools/test-contrast-full.mjs sweeps 48 routes x 30 themes but never
 *     OPENS a form, and it ends in process.exit(0) with no failure counter,
 *     so it exits 0 whatever it finds (it prints, it does not gate);
 *   - tools/test-contrast.mjs does exit 1, but only probes a handful of
 *     hand-picked surfaces and is not in CI.
 * This suite is the gate for the one place that had no coverage at all. It
 * exits 1 on a single miss.
 *
 * What it opens: every form in the catalog (read live from G.store.forms(),
 * so a new form is covered the day it ships), every tab that form offers
 * (Guided with every example expanded, Form, Fill and Fill with the sample
 * answers filled in, Bullets & Refs, Check with every answer revealed), in
 * three themes chosen to cover the three colour families:
 *   - field-manual: the default, light, textured page background;
 *   - sepia-study: a second light theme with a FLAT page background;
 *   - night-vision: dark.
 * Themes are switched with the app's own G.theme.applyTheme (the same call
 * Settings makes, so the html.light class moves with the theme - setting the
 * attribute alone, as test-contrast-full does, leaves the light rules off).
 *
 * How it measures: axe-core's color-contrast rule over the Forms view. axe
 * cannot decide text that sits on a texture or gradient (Field Manual's page
 * is a noise texture, several panels are gradients) and files it under
 * "incomplete" - which is exactly why it once looked clean there. For those
 * nodes this suite does the WCAG arithmetic itself against the solid colour
 * behind the text (nearest opaque background, opacity included), so the
 * default theme is not under-counted by design.
 *
 * Non-vacuity: two planted canaries (one axe can decide, one only the
 * texture path can) must be caught before the sweep counts, and the sweep
 * must have evaluated text in every state it visited.
 */
import fs from "node:fs";
import { bootApp, waitForRoute, clickWhenStable, until, check, ok, bad, finish } from "./testkit.mjs";

const axeSrc = fs.readFileSync(new URL(import.meta.resolve("axe-core/axe.min.js")), "utf8");

const THEMES = [
  { id: "field-manual", kind: "light", why: "the default light theme, textured page" },
  { id: "sepia-study", kind: "light", why: "a second light theme, flat page" },
  { id: "night-vision", kind: "dark", why: "dark" },
];

/* A TALL viewport on purpose: axe evaluates only the text inside the viewport
   (measured: the same page gave 15 evaluated nodes at 900px tall and 104 at
   9000px, and a planted canary near the bottom was skipped at 900). A form's
   Fill tab is over 3000px tall, so a normal-height window would silently
   judge only its first screenful. MEASURE reports where the Forms view ends,
   and the suite fails if any state ran past the bottom of the window. */
const VIEWPORT_H = 12000;
// GUIDON_WEB_DIR: optional override (the same one test-privacy.mjs has) so the
// gate itself can be proven against a scratch copy of web/ with a planted
// violation, without touching the real build.
const boot = await bootApp({ dir: process.env.GUIDON_WEB_DIR || "web", viewport: { width: 1280, height: VIEWPORT_H } });
const page = boot.page;
// Colours must be steady-state, not mid-fade (the app crossfades on theme change).
await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
await page.addScriptTag({ content: axeSrc });

/* Runs IN THE PAGE. Returns { evaluated, misses:[{sel, ratio, need, fg, bg, via, text}] }. */
const MEASURE = async () => {
  const scope = document.querySelector(".forms-view") || document.body;
  const bottom = scope.getBoundingClientRect().bottom + window.scrollY;
  const res = await axe.run(scope, { runOnly: ["color-contrast"], resultTypes: ["violations", "incomplete", "passes"], elementRef: true });
  const misses = [];
  let evaluated = 0;
  for (const p of res.passes) evaluated += p.nodes.length;
  for (const v of res.violations) {
    for (const n of v.nodes) {
      const d = (n.any[0] && n.any[0].data) || {};
      misses.push({ sel: n.target.join(" "), ratio: d.contrastRatio, need: d.expectedContrastRatio ? parseFloat(d.expectedContrastRatio) : 4.5, fg: d.fgColor, bg: d.bgColor, via: "axe", text: (n.element.textContent || "").trim().slice(0, 40) });
    }
    evaluated += v.nodes.length;
  }

  // ---- axe cannot decide text over a texture or gradient; measure those here.
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat([1]); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratioOf = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const solidBehind = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const bg = rgba(getComputedStyle(n).backgroundColor);
      if (bg[3] > 0) { stack.push(bg); if (bg[3] >= 1) break; }
    }
    let base = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  for (const v of res.incomplete) {
    for (const n of v.nodes) {
      const key = [].concat(n.any, n.all, n.none).map((c) => c && c.data && c.data.messageKey).find(Boolean);
      if (key !== "bgImage" && key !== "bgGradient") continue;
      const el = n.element;
      if (!(el.textContent || "").trim()) continue;
      const cs = getComputedStyle(el);
      const bg = solidBehind(el);
      let fg = rgba(cs.color);
      fg[3] = fg[3] * opacityOf(el);
      fg = over(fg, bg);
      const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
      const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
      const r = ratioOf(fg, bg);
      evaluated++;
      if (r < need) misses.push({ sel: n.target.join(" "), ratio: Math.round(r * 100) / 100, need, fg: "rgb(" + fg.slice(0, 3).map(Math.round).join(",") + ")", bg: "rgb(" + bg.slice(0, 3).map(Math.round).join(",") + ")", via: "texture", text: (el.textContent || "").trim().slice(0, 40) });
    }
  }
  return { evaluated, misses, bottom };
};

async function measureAllThemes() {
  const out = {};
  for (const t of THEMES) {
    await page.evaluate((id) => window.G.theme.applyTheme(id), t.id);
    out[t.id] = await page.evaluate(MEASURE);
  }
  return out;
}

/* ---- 0) the three themes are what they claim, and switching really switches ---- */
{
  const facts = await page.evaluate((ids) => ids.map((id) => {
    const th = window.G.theme.THEMES.find((x) => x.id === id);
    window.G.theme.applyTheme(id);
    return { id, kind: th && th.kind, light: document.documentElement.classList.contains("light"), attr: document.documentElement.getAttribute("data-theme") };
  }), THEMES.map((t) => t.id));
  for (const t of THEMES) {
    const f = facts.find((x) => x.id === t.id);
    check(f && f.kind === t.kind && f.light === (t.kind === "light") && f.attr === t.id,
      `theme ${t.id} is ${t.kind} (${t.why}); applyTheme sets the attribute and the .light class together`,
      () => `theme ${t.id}: ${JSON.stringify(f)}`);
  }
}

/* ---- 1) canaries: the harness must catch what it exists to catch ---- */
await waitForRoute(page, "#/forms", { ready: ".form-card" });
{
  await page.evaluate(() => {
    const host = document.querySelector(".forms-view");
    const a = document.createElement("p");
    a.id = "canary-solid";
    a.textContent = "canary text on its own solid background";
    a.style.cssText = "color:#e8f0f6;background:#ece1c6;padding:4px";
    const b = document.createElement("p");
    b.id = "canary-page";
    b.textContent = "canary text straight on the page";
    b.style.cssText = "color:#e8f0f6";
    // The honest sibling: the app's own text colour on the app's own panel,
    // exactly what a correctly written form style does. It must pass everywhere.
    const c = document.createElement("p");
    c.id = "canary-honest";
    c.textContent = "canary text in the theme's own colours";
    c.style.cssText = "color:var(--text);background:var(--panel-2);padding:4px";
    host.appendChild(a); host.appendChild(b); host.appendChild(c);
  });
  const seen = await measureAllThemes();
  const fm = seen["field-manual"].misses;
  check(fm.some((m) => m.sel.includes("canary-solid")), "canary 1: text on its own solid background (pale on cream) is caught in field-manual", () => "not caught: " + JSON.stringify(fm.slice(0, 3)));
  check(fm.some((m) => m.sel.includes("canary-page")), "canary 2: pale text straight on the textured Field Manual page is caught (the case axe files as 'incomplete')", () => "not caught: " + JSON.stringify(fm.slice(0, 3)));
  const nv = seen["night-vision"].misses;
  check(!nv.some((m) => m.sel.includes("canary-page")), "pale text straight on the DARK page is fine and is NOT flagged (the harness does not cry wolf)", () => JSON.stringify(nv.filter((m) => m.sel.includes("canary-page"))));
  check(nv.some((m) => m.sel.includes("canary-solid")), "canary 1 is caught on the dark theme too (its own cream background does not change with the theme)", () => "not caught: " + JSON.stringify(nv.slice(0, 3)));
  for (const t of THEMES) {
    const wrong = seen[t.id].misses.filter((m) => m.sel.includes("canary-honest"));
    check(wrong.length === 0, `[${t.id}] text in the theme's own --text on --panel-2 passes (an honest control is never flagged)`, () => JSON.stringify(wrong));
  }
  await page.evaluate(() => { for (const id of ["canary-solid", "canary-page", "canary-honest"]) document.getElementById(id).remove(); });
}

/* ---- 2) the sweep ---- */
const catalog = await page.evaluate(() => window.G.store.forms().forms.map((f) => ({ id: f.id, form: f.form, title: f.title })));
check(catalog.length > 1, `fixture: the catalog lists ${catalog.length} forms`, "the forms catalog is empty");

const missesByTheme = Object.fromEntries(THEMES.map((t) => [t.id, new Map()]));
const evaluated = Object.fromEntries(THEMES.map((t) => [t.id, 0]));
let states = 0;
let tallest = 0;
let formsOpened = 0;
const tabsSeen = new Set();

const settle = (label) => until(page, (l) => {
  const b = [...document.querySelectorAll(".forms-view .segmented button")].find((x) => x.textContent.trim() === l);
  const body = document.querySelector(".form-body");
  const counters = [...document.querySelectorAll(".form-body .cnt")];
  return !!(b && b.getAttribute("aria-pressed") === "true" && body && body.childElementCount > 0 && counters.every((c) => c.textContent.trim() !== ""));
}, label);

async function measureState(f, label) {
  // Expand every "Show example" / "Reveal" so hidden answer boxes are measured too.
  await page.evaluate(() => document.querySelectorAll(".forms-view .example-chip").forEach((c) => { if (/^(Show example|Reveal)$/.test(c.textContent.trim())) c.click(); }));
  states++;
  const seen = await measureAllThemes();
  for (const t of THEMES) {
    tallest = Math.max(tallest, seen[t.id].bottom);
    evaluated[t.id] += seen[t.id].evaluated;
    for (const m of seen[t.id].misses) {
      const norm = m.sel.replace(/:nth-child\(\d+\)/g, "").replace(/\[data-fid="[^"]*"\]/g, "[data-fid]");
      const key = norm + " | " + m.via;
      const e = missesByTheme[t.id].get(key) || { n: 0, forms: new Set(), ratio: m.ratio, need: m.need, fg: m.fg, bg: m.bg, at: f.id + " / " + label, text: m.text };
      e.n++; e.forms.add(f.id);
      missesByTheme[t.id].set(key, e);
    }
  }
}

for (const f of catalog) {
  await waitForRoute(page, "#/forms", { fresh: true, ready: ".form-card" });
  const idx = await page.evaluate((f) => [...document.querySelectorAll(".form-card")].findIndex((c) =>
    c.querySelector(".form-num").textContent.startsWith(f.form) && c.querySelector(".form-title").textContent === f.title), f);
  if (idx < 0) { bad(`could not find the catalog card for ${f.id} (${f.form})`); continue; }
  await clickWhenStable(page, page.locator(".form-card").nth(idx));
  await page.locator(".forms-view .segmented button").first().waitFor({ state: "visible", timeout: 15000 });
  formsOpened++;
  const tabs = await page.$$eval(".forms-view .segmented button", (bs) => bs.map((b) => b.textContent.trim()));
  for (const label of tabs) {
    tabsSeen.add(label);
    await clickWhenStable(page, page.locator(".forms-view .segmented button", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&") + "$") }));
    if (!(await settle(label))) { bad(`${f.id}: the "${label}" tab never finished drawing`); continue; }
    await measureState(f, label);
    if (label === "Fill") {
      // Fill with the sample answers typed in (counters, over-limit states, filled inputs).
      await clickWhenStable(page, page.locator(".fill-bar .btn", { hasText: /^Prefill example$/ }));
      await until(page, () => [...document.querySelectorAll(".fill-bar .btn")].some((b) => b.textContent.trim() === "Clear example") && [...document.querySelectorAll(".form-body .cnt")].every((c) => c.textContent.trim() !== ""));
      await measureState(f, "Fill (sample answers)");
      await clickWhenStable(page, page.locator(".fill-bar .btn", { hasText: /^Clear example$/ }));
      await until(page, () => [...document.querySelectorAll(".fill-bar .btn")].some((b) => b.textContent.trim() === "Prefill example"));
    }
  }
}

/* ---- 3) verdicts ---- */
check(formsOpened === catalog.length, `opened every form in the catalog (${formsOpened} of ${catalog.length})`, `opened only ${formsOpened} of ${catalog.length}`);
for (const need of ["Guided", "Form", "Fill", "Bullets & Refs", "Check"]) {
  check(tabsSeen.has(need), `the "${need}" tab was opened on at least one form`, `no form offered the "${need}" tab`);
}
check(tallest > 0 && tallest <= VIEWPORT_H, `every state fits inside the ${VIEWPORT_H}px window, so no text sat below the part axe can see (tallest ${Math.round(tallest)}px)`, `a state was ${Math.round(tallest)}px tall, taller than the ${VIEWPORT_H}px window - raise VIEWPORT_H (max 16384) or the bottom of that form is not being judged`);
check(states >= catalog.length * 4, `measured ${states} form-and-tab states (at least 4 per form)`, `only ${states} states measured for ${catalog.length} forms`);
for (const t of THEMES) {
  check(evaluated[t.id] >= states, `[${t.id}] evaluated ${evaluated[t.id]} pieces of text across ${states} states (every state had text to judge)`, `[${t.id}] only ${evaluated[t.id]} pieces of text evaluated over ${states} states - the sweep is not looking at anything`);
}
for (const t of THEMES) {
  const rows = [...missesByTheme[t.id]].sort((a, b) => b[1].n - a[1].n);
  if (!rows.length) { ok(`[${t.id}] no color-contrast miss on any form or tab (${t.why})`); continue; }
  bad(`[${t.id}] ${rows.reduce((s, r) => s + r[1].n, 0)} color-contrast miss(es) in ${rows.length} distinct place(s)`);
  for (const [key, e] of rows.slice(0, 25)) {
    console.log(`        ${key}  ${e.ratio}:1 (needs ${e.need})  ${e.fg} on ${e.bg}  x${e.n} in ${e.forms.size} form(s), first at ${e.at}: "${e.text}"`);
  }
  if (rows.length > 25) console.log(`        ... and ${rows.length - 25} more`);
}

await finish("CONTRAST-FORMS");
