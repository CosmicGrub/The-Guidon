/**
 * Auto-night 24h window bar (Settings > Interface > Auto night theme).
 *
 * Roadmap Tier 3 item: the auto-night start/end controls were two plain
 * hour <select>s with no visual of the actual night window they describe —
 * a Soldier picking 22 and 05 had no way to SEE that as "most of the
 * night" versus, say, 22 and 23 ("one hour"). src/index.html now renders a
 * compact shaded 24h bar (.night-hourbar) alongside the selects, built
 * hour-by-hour from G.theme.hourInNightWindow — the exact wrap-aware
 * [start,end) check theme.js's effectiveTheme() itself uses to decide the
 * live theme at midnight wrap — so the two can never disagree.
 *
 * This suite proves, with real getBoundingClientRect() geometry (not just
 * "no error was thrown"):
 *   1) the bar exists and its default shading matches the coded defaults
 *      (20:00-06:00, a window that wraps past midnight -> two rects).
 *   2) picking a non-wrapping window (e.g. 01:00-05:00) collapses the bar
 *      to a single rect at the right position/width.
 *   3) picking a wrapping window re-splits it into two rects, each at the
 *      fraction-of-24-hours position/width the selected hours imply.
 *   4) the bar's own aria-label names the selected hours (screen-reader
 *      parity for the same information the shading conveys visually).
 *   5) the shared wrap helper it's built on (G.theme.hourInNightWindow)
 *      agrees with effectiveTheme() at the exact wrap boundary — proving
 *      "reuse", not a second copy of the wrap math that could drift.
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

// Auto-night's controls (like the rest of "Interface") live behind the
// Advanced-tier collapse — same idiom tools/test-settings-toggles.mjs uses.
async function openAdvanced() {
  const btn = page.getByRole("button", { name: /advanced settings/i });
  const expanded = await btn.getAttribute("aria-expanded").catch(() => null);
  if (expanded !== "true") await btn.click();
  await page.waitForTimeout(150);
}
await openAdvanced();

const startSel = page.locator('select[aria-label="Auto-night start hour"]');
const endSel = page.locator('select[aria-label="Auto-night end hour"]');
await startSel.waitFor({ state: "visible", timeout: 5000 });

// ============================================================
// 0) The bar exists at all, right next to the selects it complements.
// ============================================================
const barCount = await page.locator(".night-hourbar").count();
barCount === 1
  ? ok("exactly one .night-hourbar renders in the Interface panel")
  : bad(".night-hourbar count was " + barCount + ", expected 1");

// Reads every .night-hourbar-fill rect as a fraction of the bar's own
// width/left, so the assertion is resolution-independent (works whether
// the panel renders at 320px or 1200px wide).
async function fillFractions() {
  return page.evaluate(() => {
    const bar = document.querySelector(".night-hourbar");
    if (!bar) return null;
    const br = bar.getBoundingClientRect();
    return [...bar.querySelectorAll(".night-hourbar-fill")]
      .map((f) => {
        const fr = f.getBoundingClientRect();
        return { left: (fr.left - br.left) / br.width, width: fr.width / br.width };
      })
      .sort((a, b) => a.left - b.left);
  });
}
const ariaLabel = () => page.locator(".night-hourbar").getAttribute("aria-label");
const near = (a, b, tol = 0.02) => Math.abs(a - b) < tol;

// ============================================================
// 1) Defaults (20:00-06:00) — a window that wraps past midnight, so the
//    bar must show TWO rects: [20/24, 24/24] and [0, 6/24].
// ============================================================
{
  (await startSel.inputValue()) === "20" && (await endSel.inputValue()) === "6"
    ? ok("Auto-night defaults are 20 (start) and 6 (end), as coded")
    : bad(`Auto-night default selects were start=${await startSel.inputValue()} end=${await endSel.inputValue()}, expected 20/6`);

  const frac = await fillFractions();
  frac && frac.length === 2
    ? ok(`Default window (20:00-06:00, wraps midnight): bar shows 2 rects (got ${frac ? frac.length : frac})`)
    : bad(`Default window: expected 2 rects, got ${JSON.stringify(frac)}`);
  if (frac && frac.length === 2) {
    (near(frac[0].left, 0) && near(frac[0].width, 6 / 24))
      ? ok(`Default window: first rect spans 00:00-06:00 (left=${frac[0].left.toFixed(3)}, width=${frac[0].width.toFixed(3)}, expected left~0, width~${(6/24).toFixed(3)})`)
      : bad(`Default window: first rect left=${frac[0].left.toFixed(3)} width=${frac[0].width.toFixed(3)}, expected left~0 width~${(6/24).toFixed(3)}`);
    (near(frac[1].left, 20 / 24) && near(frac[1].width, 4 / 24))
      ? ok(`Default window: second rect spans 20:00-24:00 (left=${frac[1].left.toFixed(3)}, width=${frac[1].width.toFixed(3)}, expected left~${(20/24).toFixed(3)}, width~${(4/24).toFixed(3)})`)
      : bad(`Default window: second rect left=${frac[1].left.toFixed(3)} width=${frac[1].width.toFixed(3)}, expected left~${(20/24).toFixed(3)} width~${(4/24).toFixed(3)}`);
  }
  const label = await ariaLabel();
  (label && label.includes("20:00") && label.includes("06:00"))
    ? ok(`Default window: bar's aria-label names both hours ("${label}")`)
    : bad(`Default window: bar's aria-label was "${label}", expected it to mention 20:00 and 06:00`);
}

// ============================================================
// 2) Non-wrapping window (01:00-05:00): must collapse to ONE rect at
//    exactly [1/24, 5/24].
// ============================================================
{
  await startSel.selectOption("1");
  await endSel.selectOption("5");
  await page.waitForTimeout(150);

  const frac = await fillFractions();
  frac && frac.length === 1
    ? ok(`Non-wrapping window (01:00-05:00): bar collapses to 1 rect (got ${frac ? frac.length : frac})`)
    : bad(`Non-wrapping window: expected 1 rect, got ${JSON.stringify(frac)}`);
  if (frac && frac.length === 1) {
    (near(frac[0].left, 1 / 24) && near(frac[0].width, 4 / 24))
      ? ok(`Non-wrapping window: rect at left=${frac[0].left.toFixed(3)} width=${frac[0].width.toFixed(3)} matches 01:00-05:00 (expected left~${(1/24).toFixed(3)} width~${(4/24).toFixed(3)})`)
      : bad(`Non-wrapping window: rect left=${frac[0].left.toFixed(3)} width=${frac[0].width.toFixed(3)}, expected left~${(1/24).toFixed(3)} width~${(4/24).toFixed(3)}`);
  }
  const label = await ariaLabel();
  (label && label.includes("01:00") && label.includes("05:00"))
    ? ok(`Non-wrapping window: aria-label updated to name the new hours ("${label}")`)
    : bad(`Non-wrapping window: aria-label was "${label}", expected it to mention 01:00 and 05:00`);
}

// ============================================================
// 3) Re-picking a wrapping window (22:00-04:00) must re-split back into
//    two rects at the NEW fractions — proves live re-render, not a
//    one-time paint.
// ============================================================
{
  await startSel.selectOption("22");
  await endSel.selectOption("4");
  await page.waitForTimeout(150);

  const frac = await fillFractions();
  frac && frac.length === 2
    ? ok(`Re-picked wrapping window (22:00-04:00): bar re-splits to 2 rects (got ${frac ? frac.length : frac})`)
    : bad(`Re-picked wrapping window: expected 2 rects, got ${JSON.stringify(frac)}`);
  if (frac && frac.length === 2) {
    (near(frac[0].left, 0) && near(frac[0].width, 4 / 24))
      ? ok(`Re-picked wrapping window: first rect spans 00:00-04:00 (left=${frac[0].left.toFixed(3)}, width=${frac[0].width.toFixed(3)})`)
      : bad(`Re-picked wrapping window: first rect left=${frac[0].left.toFixed(3)} width=${frac[0].width.toFixed(3)}, expected left~0 width~${(4/24).toFixed(3)}`);
    (near(frac[1].left, 22 / 24) && near(frac[1].width, 2 / 24))
      ? ok(`Re-picked wrapping window: second rect spans 22:00-24:00 (left=${frac[1].left.toFixed(3)}, width=${frac[1].width.toFixed(3)})`)
      : bad(`Re-picked wrapping window: second rect left=${frac[1].left.toFixed(3)} width=${frac[1].width.toFixed(3)}, expected left~${(22/24).toFixed(3)} width~${(2/24).toFixed(3)}`);
  }
}

// ============================================================
// 4) The values actually persisted through store.setSetting (the selects
//    remain the real input, per the roadmap's "keep the selects as the
//    real input, bar as a visual complement" guidance) — not just an
//    in-memory bar redraw disconnected from the app's own settings.
//    settings.js's own debouncedSettingsSave() coalesces writes 300ms
//    (see src/index.html) before it actually reaches IndexedDB — same
//    wait tools/test-settings-toggles.mjs uses before checking storage.
// ============================================================
{
  await page.waitForTimeout(300);
  const settings = await page.evaluate(async () => {
    const r = await window.G.db.get("kv", "settings");
    return r && r.v;
  });
  settings && settings.autoNightStart === 22 && settings.autoNightEnd === 4
    ? ok("selecting new hours actually persists autoNightStart/autoNightEnd via store.setSetting (settings kv row shows 22/4)")
    : bad("settings kv row after selecting 22/4 was: " + JSON.stringify(settings && { s: settings.autoNightStart, e: settings.autoNightEnd }));
}

// ============================================================
// 5) The shared wrap helper agrees with effectiveTheme() at the wrap
//    boundary itself — the actual "reuse, don't reinvent" contract.
//    22:00 and 03:59 must read as night; 04:00 (the end hour, exclusive)
//    must not, for the 22:00-04:00 window still selected above.
// ============================================================
{
  const r = await page.evaluate(() => {
    const T = window.G.theme;
    return {
      at22: T.hourInNightWindow(22, 22, 4),
      at3_59: T.hourInNightWindow(3, 22, 4), // hour 3 covers 03:00-03:59
      at4: T.hourInNightWindow(4, 22, 4),   // end hour is exclusive
      effectiveAt4: T.effectiveTheme({ autoNight: true, autoNightStart: 22, autoNightEnd: 4, autoNightTheme: "night-vision", theme: "field-manual" }),
    };
  });
  (r.at22 === true && r.at3_59 === true && r.at4 === false)
    ? ok("G.theme.hourInNightWindow(h,22,4) is true at 22:00 and 03:00, false at the exclusive end hour 04:00 — matches effectiveTheme()'s own wrap math")
    : bad("hourInNightWindow boundary check: " + JSON.stringify(r));
}

// Restore the coded defaults so this test leaves no residue for others.
await startSel.selectOption("20");
await endSel.selectOption("6");
await page.waitForTimeout(150);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad(relevantNoise.length + " console msg(s); first: " + relevantNoise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `AUTO-NIGHT HOUR BAR: ${fails} FAILURE(S)` : "AUTO-NIGHT HOUR BAR: all passed"));
process.exit(fails ? 1 : 0);
