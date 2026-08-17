/**
 * Settings -> accessibility/appearance toggles: assertion-level coverage for
 * the six controls that were each previously buggy and fixed in earlier
 * work (see src/index.html's own comments at each CSS rule below):
 *   - Text size      - only scaled <body>'s font-size, leaving ~460 rem-sized
 *                      component rules anchored to the browser's unscaled
 *                      16px root (rem is relative to <html>, not <body>).
 *   - Line spacing    - body's line-height honored the setting, but a
 *                      handful of components hardcoded their own
 *                      line-height and never picked it up at all.
 *   - Larger tap targets - the shared .tabbar/.tab component (IDP, Forms
 *                      Trainer, Finance, Transition, ...) was left off the
 *                      selector list entirely.
 *   - Reduce transparency - only ever touched two selectors that don't
 *                      exist anywhere in the app; the real ~140+ translucent
 *                      surfaces (.feedback foremost) were untouched.
 *   - High contrast   - boosts border width on .panel/.card.
 *   - Bold focus ring - thickens the keyboard :focus-visible outline.
 *
 * The generic route/a11y sweeps (test-a11y-tree.mjs, test-contrast-full.mjs)
 * load #/settings once per theme and never touch these controls, so none of
 * them had real "flip it, verify a computed style actually changed, flip it
 * back, verify it reverted" coverage anywhere. Every assertion below reads
 * a real getComputedStyle() value (or a CSS custom property) before/after,
 * matching the rigor of tools/test-contrast-full.mjs's own real-pixel
 * assertions rather than "no error was thrown".
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(500);

// Known-clean baseline for every pref this file touches, set via the app's
// own real API (same pattern tools/test-idp.mjs uses via window.G.db) so
// each block below starts from a state independent of the others.
async function resetPrefs() {
  await page.evaluate(async () => {
    const t = window.G.theme;
    await t.setPref("textScale", "standard");
    await t.setPref("lineSpacing", "normal");
    await t.setPref("highContrast", false);
    await t.setPref("largeTargets", false);
    await t.setPref("reduceTransparency", false);
    await t.setPref("boldFocus", false);
    await t.setPref("contentDensity", "standard");
  });
  await page.waitForTimeout(150);
}
await resetPrefs();

// The checkbox <input> for each Accessibility & Focus toggle is visually
// hidden (.toggle input { opacity:0; width:0; height:0 }) behind a styled
// <label class="toggle"> track/knob -- real UI, but Playwright's normal
// .click() actionability check refuses it as "not visible". A native
// element.click() is exactly what the visible <label> would trigger (same
// 'click' -> 'change' event chain the checkbox's own listener reacts to),
// so this exercises the real control without fighting a CSS-hidden native
// widget that's a deliberate, working design (see .toggle CSS).
async function clickCheckbox(label) {
  const cb = page.getByRole("checkbox", { name: label, exact: true });
  await cb.evaluate((el) => el.click());
}

// ============================================================
// 1) TEXT SIZE - segmented control (Appearance panel), not a checkbox.
//    Real fix under test: font-size lives on <html>, so a component sized
//    in rem (not just body copy) scales too.
// ============================================================
{
  const rootFont = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  // "Export backup" (.btn.sm -> font-size:.75rem; renamed from "Export
  // progress" for task #249) is a real, unrelated rem-sized COMPONENT
  // elsewhere on the same Settings page -- if only body's font-size moved
  // (the original bug), this would never change.
  const componentFont = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Export backup/.test(x.textContent || ""));
    return b ? parseFloat(getComputedStyle(b).fontSize) : null;
  });

  const rootBefore = await rootFont();
  const compBefore = await componentFont();
  compBefore != null ? ok("Text size: found the 'Export backup' component button for a real rem check") : bad("Text size: could not find the 'Export backup' button");

  await page.getByRole("button", { name: "Large text size", exact: true }).click();
  await page.waitForTimeout(200);
  const rootLarge = await rootFont();
  const compLarge = await componentFont();

  rootLarge > rootBefore
    ? ok(`Text size 'Large': <html> font-size grew (${rootBefore}px -> ${rootLarge}px)`)
    : bad(`Text size 'Large': <html> font-size did not grow (${rootBefore}px -> ${rootLarge}px)`);
  (compLarge != null && compBefore != null && compLarge > compBefore)
    ? ok(`Text size 'Large': a real rem-sized component also grew (${compBefore}px -> ${compLarge}px) -- not just body`)
    : bad(`Text size 'Large': component font-size did not grow (${compBefore}px -> ${compLarge}px)`);
  // The component tracks the root via rem, so the two ratios should match
  // (within float rounding) -- the exact bug that was fixed.
  if (compBefore && compLarge && rootBefore && rootLarge) {
    const rootRatio = rootLarge / rootBefore, compRatio = compLarge / compBefore;
    Math.abs(rootRatio - compRatio) < 0.02
      ? ok(`Text size 'Large': component scaled by the same ratio as <html> (${compRatio.toFixed(3)} vs ${rootRatio.toFixed(3)})`)
      : bad(`Text size 'Large': component ratio ${compRatio.toFixed(3)} does not track root ratio ${rootRatio.toFixed(3)}`);
  }

  await page.getByRole("button", { name: "Standard text size", exact: true }).click();
  await page.waitForTimeout(200);
  const rootBack = await rootFont();
  const compBack = await componentFont();
  Math.abs(rootBack - rootBefore) < 0.01
    ? ok("Text size 'Standard': <html> font-size reverted to its original value")
    : bad(`Text size 'Standard': <html> font-size did not revert (${rootBefore}px -> ${rootBack}px)`);
  (compBack != null && compBefore != null && Math.abs(compBack - compBefore) < 0.01)
    ? ok("Text size 'Standard': component font-size reverted too")
    : bad(`Text size 'Standard': component font-size did not revert (${compBefore}px -> ${compBack}px)`);
}

// ============================================================
// 2) LINE SPACING - segmented control (Appearance panel).
//    Real fix under test: --line-spacing-scale custom property, which the
//    handful of components with a hardcoded baseline opt into via
//    calc(<baseline> * var(--line-spacing-scale, 1)) -- not just body's
//    own line-height, which honored the setting even before the fix.
// ============================================================
{
  const bodyLineHeight = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).lineHeight));
  const scaleVar = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--line-spacing-scale").trim());

  const lhBefore = await bodyLineHeight();
  const scaleBefore = await scaleVar();
  scaleBefore === "1" ? ok(`Line spacing 'Normal': --line-spacing-scale is 1 (baseline)`) : bad(`Line spacing 'Normal': --line-spacing-scale was "${scaleBefore}", expected "1"`);

  await page.getByRole("button", { name: "Relaxed line spacing", exact: true }).click();
  await page.waitForTimeout(200);
  const lhRelaxed = await bodyLineHeight();
  const scaleRelaxed = await scaleVar();
  lhRelaxed > lhBefore
    ? ok(`Line spacing 'Relaxed': body line-height grew (${lhBefore}px -> ${lhRelaxed}px)`)
    : bad(`Line spacing 'Relaxed': body line-height did not grow (${lhBefore}px -> ${lhRelaxed}px)`);
  scaleRelaxed === "1.147"
    ? ok(`Line spacing 'Relaxed': --line-spacing-scale is 1.147 (the value hardcoded-line-height components opt into)`)
    : bad(`Line spacing 'Relaxed': --line-spacing-scale was "${scaleRelaxed}", expected "1.147"`);

  await page.getByRole("button", { name: "Tight line spacing", exact: true }).click();
  await page.waitForTimeout(200);
  const lhTight = await bodyLineHeight();
  const scaleTight = await scaleVar();
  lhTight < lhBefore
    ? ok(`Line spacing 'Tight': body line-height shrank below Normal (${lhBefore}px -> ${lhTight}px)`)
    : bad(`Line spacing 'Tight': body line-height did not shrink (${lhBefore}px -> ${lhTight}px)`);
  // Browsers may report the authored form (".9") rather than a
  // leading-zero-normalized "0.9" for a custom property's computed value,
  // so compare numerically rather than as an exact string.
  parseFloat(scaleTight) === 0.9
    ? ok(`Line spacing 'Tight': --line-spacing-scale is 0.9 (raw: "${scaleTight}")`)
    : bad(`Line spacing 'Tight': --line-spacing-scale was "${scaleTight}", expected 0.9`);

  await page.getByRole("button", { name: "Normal line spacing", exact: true }).click();
  await page.waitForTimeout(200);
  const lhBack = await bodyLineHeight();
  const scaleBack = await scaleVar();
  Math.abs(lhBack - lhBefore) < 0.01
    ? ok("Line spacing 'Normal': body line-height reverted to its original value")
    : bad(`Line spacing 'Normal': body line-height did not revert (${lhBefore}px -> ${lhBack}px)`);
  scaleBack === "1" ? ok("Line spacing 'Normal': --line-spacing-scale reverted to 1") : bad(`Line spacing 'Normal': --line-spacing-scale was "${scaleBack}"`);
}

// ============================================================
// 3) HIGH CONTRAST - checkbox (Accessibility & Focus panel).
//    Real fix under test: html.hc .panel border-width goes from 1px to 2px.
// ============================================================
{
  const panelBorder = () => page.evaluate(() => {
    const p = document.querySelector(".panel");
    return p ? getComputedStyle(p).borderWidth : null;
  });

  const before = await panelBorder();
  before === "1px" ? ok(`High contrast off: a real .panel border-width is 1px (baseline)`) : bad(`High contrast off: .panel border-width was "${before}", expected "1px"`);

  await clickCheckbox("High contrast");
  await page.waitForTimeout(200);
  const on = await panelBorder();
  on === "2px" ? ok(`High contrast on: .panel border-width boosted to 2px`) : bad(`High contrast on: .panel border-width was "${on}", expected "2px"`);

  await clickCheckbox("High contrast");
  await page.waitForTimeout(200);
  const off = await panelBorder();
  off === "1px" ? ok(`High contrast off again: .panel border-width reverted to 1px`) : bad(`High contrast off again: .panel border-width was "${off}", expected "1px"`);
}

// ============================================================
// 4) LARGER TAP TARGETS - checkbox (Accessibility & Focus panel).
//    Real fix under test: the shared .tabbar .tab component (used by IDP,
//    Forms Trainer, Finance, Transition, ...) picks up the >=48px minimum,
//    where before it was silently skipped.
// ============================================================
{
  await page.evaluate(() => { location.hash = "#/develop"; });
  await page.waitForTimeout(500);
  const tabMinHeight = () => page.evaluate(() => {
    const t = document.querySelector(".tabbar .tab");
    return t ? getComputedStyle(t).minHeight : null;
  });

  const before = await tabMinHeight();
  (before === "0px" || before === "auto") ? ok(`Larger tap targets off: .tabbar .tab min-height is "${before}" (baseline, no explicit minimum)`) : bad(`Larger tap targets off: .tabbar .tab min-height was "${before}", expected "0px"/"auto"`);

  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);
  await clickCheckbox("Larger tap targets");
  await page.waitForTimeout(150);

  await page.evaluate(() => { location.hash = "#/develop"; });
  await page.waitForTimeout(500);
  const on = await tabMinHeight();
  on === "48px"
    ? ok("Larger tap targets on: the shared .tabbar .tab component picked up min-height:48px (the fixed bug)")
    : bad(`Larger tap targets on: .tabbar .tab min-height was "${on}", expected "48px"`);

  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);
  await clickCheckbox("Larger tap targets");
  await page.waitForTimeout(150);

  await page.evaluate(() => { location.hash = "#/develop"; });
  await page.waitForTimeout(500);
  const off = await tabMinHeight();
  (off === "0px" || off === "auto")
    ? ok(`Larger tap targets off again: .tabbar .tab min-height reverted to "${off}"`)
    : bad(`Larger tap targets off again: .tabbar .tab min-height was "${off}", expected to revert`);
}

// ============================================================
// 5) REDUCE TRANSPARENCY - checkbox (Accessibility & Focus panel).
//    Real fix under test: .feedback (the app's most pervasive translucent
//    surface, used for every disclaimer/warning banner) gets a solid
//    (fully opaque) background instead of a low-alpha rgba() tint.
// ============================================================
{
  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);

  const feedbackAlpha = () => page.evaluate(() => {
    const f = document.querySelector(".feedback.warn");
    if (!f) return null;
    // Chromium reports plain rgba()'s literal low alpha as "rgba(r, g, b, a)",
    // but a color-mix() result (the reduce-transparency branch) computes to
    // the "color(srgb r g b [/ a])" function form instead - both need to
    // parse cleanly since which one applies is exactly what's under test.
    const bg = getComputedStyle(f).backgroundColor;
    const rgba = /rgba?\(([^)]+)\)/.exec(bg);
    if (rgba) {
      const parts = rgba[1].split(",").map((s) => parseFloat(s));
      return parts.length === 4 ? parts[3] : 1;
    }
    const colorFn = /color\([^)]*\/\s*([\d.]+)\s*\)/.exec(bg);
    if (colorFn) return parseFloat(colorFn[1]);
    return /^color\(/.test(bg) ? 1 : null; // color(srgb r g b) with no "/ a" => opaque
  });

  await page.evaluate(() => { location.hash = "#/money"; });
  await page.waitForTimeout(500);
  const alphaBefore = await feedbackAlpha();
  (alphaBefore != null && alphaBefore < 0.2)
    ? ok(`Reduce transparency off: .feedback.warn background is a low-alpha tint (alpha=${alphaBefore})`)
    : bad(`Reduce transparency off: .feedback.warn alpha was ${alphaBefore}, expected a low value (~0.07)`);

  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);
  await clickCheckbox("Reduce transparency");
  await page.waitForTimeout(150);

  await page.evaluate(() => { location.hash = "#/money"; });
  await page.waitForTimeout(500);
  const alphaOn = await feedbackAlpha();
  (alphaOn != null && alphaOn >= 0.99)
    ? ok(`Reduce transparency on: .feedback.warn background is now fully opaque (alpha=${alphaOn}) instead of a translucent tint`)
    : bad(`Reduce transparency on: .feedback.warn alpha was ${alphaOn}, expected ~1 (opaque)`);

  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);
  await clickCheckbox("Reduce transparency");
  await page.waitForTimeout(150);

  await page.evaluate(() => { location.hash = "#/money"; });
  await page.waitForTimeout(500);
  const alphaOff = await feedbackAlpha();
  (alphaOff != null && alphaOff < 0.2)
    ? ok(`Reduce transparency off again: .feedback.warn background reverted to a low-alpha tint (alpha=${alphaOff})`)
    : bad(`Reduce transparency off again: .feedback.warn alpha was ${alphaOff}, expected to revert to ~0.07`);
}

// ============================================================
// 6) BOLD FOCUS RING - checkbox (Accessibility & Focus panel).
//    Real fix under test: the keyboard :focus-visible outline thickens
//    from 2px to 3px. Chromium only renders :focus-visible once the page
//    has seen a real keyboard interaction (a plain scripted .focus() with
//    no prior keydown does not qualify), and the button's own
//    `transition: all .15s` means the computed outline-width needs a beat
//    to settle after focus changes -- both handled below.
// ============================================================
{
  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);

  async function focusedOutline() {
    await page.keyboard.press("Tab"); // establishes real keyboard input modality
    // Renamed to "Export backup" for task #249 (was "Export progress" -
    // this button just needs to be SOME real focusable element on the
    // Settings page; which one is incidental to what this check tests).
    await page.getByRole("button", { name: "Export backup", exact: true }).focus();
    await page.waitForTimeout(250); // let the .15s outline transition settle
    return page.evaluate(() => {
      const e = document.activeElement;
      return { focusVisible: e.matches(":focus-visible"), width: getComputedStyle(e).outlineWidth, style: getComputedStyle(e).outlineStyle };
    });
  }

  const before = await focusedOutline();
  (before.focusVisible && before.style === "solid" && before.width === "2px")
    ? ok(`Bold focus off: keyboard focus-visible outline is 2px solid (baseline)`)
    : bad(`Bold focus off: focus-visible=${before.focusVisible} style=${before.style} width=${before.width}, expected solid 2px`);

  await clickCheckbox("Bold focus ring");
  await page.waitForTimeout(150);
  const on = await focusedOutline();
  (on.focusVisible && on.style === "solid" && on.width === "3px")
    ? ok(`Bold focus on: keyboard focus-visible outline thickened to 3px solid`)
    : bad(`Bold focus on: focus-visible=${on.focusVisible} style=${on.style} width=${on.width}, expected solid 3px`);

  await clickCheckbox("Bold focus ring");
  await page.waitForTimeout(150);
  const off = await focusedOutline();
  (off.focusVisible && off.style === "solid" && off.width === "2px")
    ? ok(`Bold focus off again: keyboard focus-visible outline reverted to 2px solid`)
    : bad(`Bold focus off again: focus-visible=${off.focusVisible} style=${off.style} width=${off.width}, expected solid 2px`);
}

// ============================================================
// 7) CONTENT DENSITY - segmented control (Appearance panel), shipped but
//    never previously exercised end-to-end. Real behavior under test:
//    panel/card/tile spacing changes, [data-content-density] on <html>
//    tracks the choice, the choice survives a real reload (proving the
//    pre-paint localStorage mirror + syncFromSettings() boot path, not
//    just the live in-session theme.setPref() call), and - the module's
//    own stated design rule - body-copy font-size never moves, so density
//    never trades off against readability.
// ============================================================
{
  const panelPadding = () => page.evaluate(() => {
    const p = document.querySelector(".panel");
    return p ? getComputedStyle(p).paddingTop : null;
  });
  const densityAttr = () => page.evaluate(() => document.documentElement.getAttribute("data-content-density"));
  // A real body-copy element (a .hint paragraph), not a component that
  // legitimately scales with density - proves density is spacing-only.
  const hintFontSize = () => page.evaluate(() => {
    const h = document.querySelector(".hint");
    return h ? getComputedStyle(h).fontSize : null;
  });
  // The Settings page itself has no .card elements, only .panel - Calendar's
  // "Your dates" inputs (src/app-modules/calendar.js) does, and the CSS rule
  // under test (html[data-content-density] .card) is global, so reading it
  // there is exactly as valid as reading it on Settings.
  async function cardPaddingOnCalendar() {
    await page.evaluate(() => { location.hash = "#/calendar"; });
    await page.waitForTimeout(400);
    const v = await page.evaluate(() => {
      const c = document.querySelector(".card");
      return c ? getComputedStyle(c).paddingTop : null;
    });
    await page.evaluate(() => { location.hash = "#/settings"; });
    await page.waitForTimeout(400);
    return v;
  }

  const paddingBefore = await panelPadding();
  const cardBefore = await cardPaddingOnCalendar();
  const fontBefore = await hintFontSize();
  paddingBefore === "16px" ? ok(`Content density 'Standard': .panel padding is 16px (baseline)`) : bad(`Content density 'Standard': .panel padding was "${paddingBefore}", expected "16px"`);
  cardBefore === "14px" ? ok(`Content density 'Standard': .card padding is 14px (baseline)`) : bad(`Content density 'Standard': .card padding was "${cardBefore}", expected "14px"`);
  (await densityAttr()) === "standard" ? ok(`Content density 'Standard': <html data-content-density="standard">`) : bad(`Content density attribute was "${await densityAttr()}", expected "standard"`);

  await page.getByRole("button", { name: "Sparse content density", exact: true }).click();
  await page.waitForTimeout(200);
  const paddingSparse = await panelPadding();
  const cardSparse = await cardPaddingOnCalendar();
  paddingSparse === "22px"
    ? ok(`Content density 'Sparse': .panel padding widened to 22px`)
    : bad(`Content density 'Sparse': .panel padding was "${paddingSparse}", expected "22px"`);
  cardSparse === "20px"
    ? ok(`Content density 'Sparse': .card padding widened to 20px`)
    : bad(`Content density 'Sparse': .card padding was "${cardSparse}", expected "20px"`);
  (await densityAttr()) === "sparse" ? ok(`Content density 'Sparse': <html data-content-density="sparse">`) : bad(`Content density attribute was "${await densityAttr()}", expected "sparse"`);
  (await hintFontSize()) === fontBefore
    ? ok(`Content density 'Sparse': body-copy font-size unchanged (${fontBefore}) - spacing only, as designed`)
    : bad(`Content density 'Sparse': .hint font-size changed (${fontBefore} -> ${await hintFontSize()})`);

  await page.getByRole("button", { name: "Dense content density", exact: true }).click();
  await page.waitForTimeout(200);
  const paddingDense = await panelPadding();
  const cardDense = await cardPaddingOnCalendar();
  paddingDense === "11px"
    ? ok(`Content density 'Dense': .panel padding tightened to 11px`)
    : bad(`Content density 'Dense': .panel padding was "${paddingDense}", expected "11px"`);
  cardDense === "10px"
    ? ok(`Content density 'Dense': .card padding tightened to 10px`)
    : bad(`Content density 'Dense': .card padding was "${cardDense}", expected "10px"`);
  (await densityAttr()) === "dense" ? ok(`Content density 'Dense': <html data-content-density="dense">`) : bad(`Content density attribute was "${await densityAttr()}", expected "dense"`);
  (await hintFontSize()) === fontBefore
    ? ok(`Content density 'Dense': body-copy font-size unchanged (${fontBefore}) - spacing only, as designed`)
    : bad(`Content density 'Dense': .hint font-size changed (${fontBefore} -> ${await hintFontSize()})`);

  // Persistence: a real reload, not just the in-session setPref() call -
  // exercises the pre-paint localStorage mirror (avoids a flash of the
  // wrong density) and app.start()'s G.theme.syncFromSettings() boot path.
  // theme.setPref()'s store.setSetting() write is debounced 300ms
  // (db.js/store.js's debouncedSettingsSave) - clears via pagehide/
  // visibilitychange in a real close/reload, but a scripted reload fired
  // faster than that window would race it, so wait the debounce out first
  // (same idiom as test-ppw.mjs's own persistence check).
  await page.waitForTimeout(400);
  // A reload re-runs onboarding for a guest session (profile is in-memory
  // only, unlike settings/contentDensity, which is real IndexedDB and
  // survives) - dismiss it again, same as the very first page load above,
  // before touching the Settings page underneath it.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1000);
  const guestCardAgain = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCardAgain.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCardAgain.count()) {
    await guestCardAgain.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(500);
  const densityAfterReload = await densityAttr();
  const paddingAfterReload = await panelPadding();
  densityAfterReload === "dense"
    ? ok("Content density 'Dense' survives a real reload (data-content-density still 'dense')")
    : bad(`Content density after reload was "${densityAfterReload}", expected "dense"`);
  paddingAfterReload === "11px"
    ? ok("Content density 'Dense': .panel padding is still 11px after reload, not just the attribute")
    : bad(`.panel padding after reload was "${paddingAfterReload}", expected "11px"`);

  await page.getByRole("button", { name: "Standard content density", exact: true }).click();
  await page.waitForTimeout(200);
  const paddingBack = await panelPadding();
  const cardBack = await cardPaddingOnCalendar();
  paddingBack === paddingBefore
    ? ok("Content density 'Standard': .panel padding reverted to its original value")
    : bad(`Content density 'Standard' revert: .panel padding was "${paddingBack}", expected "${paddingBefore}"`);
  cardBack === cardBefore
    ? ok("Content density 'Standard': .card padding reverted to its original value")
    : bad(`Content density 'Standard' revert: .card padding was "${cardBack}", expected "${cardBefore}"`);
}

// ============================================================
// 8) FOCUS TIER E7-E9 DISCLOSURE - segmented <select> (Appearance panel).
//    Real fix under test: zero board questions/scenarios are tagged past
//    E6, so selecting a senior-NCO tier used to silently collapse the
//    content pool with no indication anywhere in this UI. A guest session
//    (in scope here, unlike a personal profile) never triggers the
//    separate rank-change confirm dialog, so tierSel.value changes apply
//    immediately - exactly what this check needs.
// ============================================================
{
  const tierSel = page.locator('select[aria-label^="Focus tier"]');
  const hintText = () => page.evaluate(() => {
    const sel = document.querySelector('select[aria-label^="Focus tier"]');
    const hint = sel ? sel.closest(".panel").querySelector("p.hint") : null;
    return hint ? hint.textContent : null;
  });

  await tierSel.selectOption("E5");
  await page.waitForTimeout(200);
  const hintAtE5 = await hintText();
  (!hintAtE5 || hintAtE5 === "")
    ? ok("Focus tier E5: no E7-E9 disclosure shown (board/scenario content is tagged through E6)")
    : bad("Focus tier E5: unexpected hint text: " + hintAtE5);

  await tierSel.selectOption("E7");
  await page.waitForTimeout(200);
  const hintAtE7 = await hintText();
  (hintAtE7 && /tagged only through E6\/SSG/.test(hintAtE7) && hintAtE7.includes("E7"))
    ? ok("Focus tier E7: discloses that board/scenario/doctrine content tops out at E6")
    : bad("Focus tier E7: hint text was " + JSON.stringify(hintAtE7));

  await tierSel.selectOption("E9");
  await page.waitForTimeout(200);
  const hintAtE9 = await hintText();
  (hintAtE9 && hintAtE9.includes("E9"))
    ? ok("Focus tier E9: disclosure names the actually-selected tier (E9), not a stale E7")
    : bad("Focus tier E9: hint text was " + JSON.stringify(hintAtE9));

  await tierSel.selectOption("all");
  await page.waitForTimeout(200);
  const hintAtAll = await hintText();
  (!hintAtAll || hintAtAll === "")
    ? ok("Focus tier 'All ranks': disclosure hides again")
    : bad("Focus tier 'All ranks': unexpected hint text: " + hintAtAll);
}

// ---- Audit finding (ux-consistency): Focus tier confirm gate ----
// This control is labeled only as a content filter, but store.setSetting's
// own bidirectional sync also overwrites a PERSONAL account's saved rank
// and clears its action plan. Seeded directly (not via the guest flow
// above, since the confirm only applies to non-guest profiles) - a reload
// is required since G.profile.current() caches, and a raw db.put alone
// wouldn't be picked up.
await page.evaluate(async () => {
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
    actionPlan: [{ id: "x", action: "test goal" }],
  } });
  // Seed settings.tierFilter directly onto the real "settings" kv row (the
  // Focus tier <select>'s own read path) - store.setSetting's override
  // also reads G.profile.current(), whose cache would still hold the
  // guest session from the setup above until this same reload flushes it,
  // so seeding goes straight to storage rather than through that wrapper.
  const s = await window.G.db.get("kv", "settings");
  const sv = Object.assign({}, s && s.v, { tierFilter: "E5" });
  await window.G.db.put("kv", { k: "settings", v: sv });
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(500);

const tierSelect = page.locator('select[aria-label^="Focus tier"]');
await tierSelect.waitFor({ state: "visible", timeout: 5000 });
const tierBefore = await tierSelect.inputValue();
tierBefore === "E5" ? ok("Focus tier seeded correctly (E5) before the confirm-gate test") : bad("seeded tier: " + tierBefore);

await tierSelect.selectOption("E6");
await page.waitForTimeout(300);
const tierConfirmBox = page.locator(".gm-box", { hasText: /also updates your rank/ });
(await tierConfirmBox.count()) > 0
  ? ok("Changing Focus tier for a real profile opens a confirm naming the rank/action-plan consequence")
  : bad("Focus tier confirm dialog did not appear");

// Cancel: the select must revert, and nothing in storage should change.
await page.locator(".gm-box button", { hasText: /Cancel/ }).click();
await page.waitForTimeout(300);
const tierAfterCancel = await tierSelect.inputValue();
tierAfterCancel === "E5" ? ok("Cancelling the confirm reverts the select back to E5") : bad("select value after cancel: " + tierAfterCancel);
const profileAfterCancel = await page.evaluate(async () => { const r = await window.G.db.get("kv", "guidon:profile:v1"); return r && r.v; });
profileAfterCancel && profileAfterCancel.tier === "E5" && Array.isArray(profileAfterCancel.actionPlan) && profileAfterCancel.actionPlan.length === 1
  ? ok("Cancelling leaves profile.tier and the action plan untouched")
  : bad("profile after cancel: " + JSON.stringify(profileAfterCancel));

// Confirm this time: the change and the disclosed consequence both happen for real.
await tierSelect.selectOption("E6");
await page.waitForTimeout(300);
await page.locator(".gm-box button", { hasText: /Continue/ }).click();
await page.waitForTimeout(300);
const profileAfterConfirm = await page.evaluate(async () => { const r = await window.G.db.get("kv", "guidon:profile:v1"); return r && r.v; });
profileAfterConfirm && profileAfterConfirm.tier === "E6"
  ? ok("Confirming actually updates profile.tier to E6")
  : bad("profile.tier after confirming: " + (profileAfterConfirm && profileAfterConfirm.tier));
Array.isArray(profileAfterConfirm && profileAfterConfirm.actionPlan) && profileAfterConfirm.actionPlan.length === 0
  ? ok("Confirming clears the action plan, exactly as the dialog disclosed it would")
  : bad("action plan after confirming: " + JSON.stringify(profileAfterConfirm && profileAfterConfirm.actionPlan));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad(relevantNoise.length + " console msg(s); first: " + relevantNoise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `SETTINGS TOGGLES: ${fails} FAILURE(S)` : "SETTINGS TOGGLES: all passed"));
process.exit(fails ? 1 : 0);
