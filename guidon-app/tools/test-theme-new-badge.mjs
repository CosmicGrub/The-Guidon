/**
 * Theme picker "New" badge: THEMES' newest wave (the ten Focus-set themes
 * added in session 35 - see js/theme.js's own THEMES registry comment,
 * right above `const THEMES = [`, for the `since` field convention) now
 * carries `since: "session-35"`, and Settings' theme wall renders a visible
 * "New" badge (.tsb-new, reusing the existing .badge.green component - see
 * the "Generic badge" CSS block) on exactly those swatch buttons.
 *
 * BACKGROUND: the wall is collapsed by default (see the "Collapsed by
 * default" comment at its call site in src/index.html, just above the
 * "Change theme ▾" toggle button) precisely because the always-open
 * 24-theme grid made Settings the longest page in the app - but that same
 * collapse meant a returning Soldier who already picked a theme once had
 * zero in-app signal that a newer batch existed at all. The only place
 * that fact lived was a source comment ("Focus set (session 35)") nobody
 * using the app could ever see.
 *
 * This file proves three things a passing-but-shallow test could each
 * separately miss:
 *   1. DATA     - exactly the 10 session-35 ids (and no others) carry
 *                 `since` in the live THEMES registry, read straight from
 *                 window.G.theme - not re-derived from a hardcoded list
 *                 that could drift from the actual registry.
 *   2. UI WIRING - opening the real theme wall (a real click on the real
 *                 toggle, same as tools/test-settings-toggles.mjs's own
 *                 collapse checks) and reading the live DOM, every
 *                 session-35 swatch button shows a "New" badge and every
 *                 other swatch button (one sampled from each of the older
 *                 v0.42/v0.43 waves) does not.
 *   3. ACCESSIBILITY - the badge text is plain visible text (not
 *                 aria-hidden the way the checkmark icon is), so it lands
 *                 in the button's own accessible name - a screen-reader
 *                 Soldier gets the same "this one's new" signal a sighted
 *                 one gets from the badge's color.
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

const FOCUS_SESSION_35 = ["graphite-calm", "umber-lamp", "pine-dusk", "slate-quiet", "clay-warm",
  "harbor-mid", "parchment-read", "bone-neutral", "overcast-glare", "sandstone-sun"];
const NAME_BY_ID = {
  "graphite-calm": "Graphite Calm", "umber-lamp": "Umber Lamp", "pine-dusk": "Pine Dusk",
  "slate-quiet": "Slate Quiet", "clay-warm": "Clay Warm", "harbor-mid": "Harbor Mid",
  "parchment-read": "Parchment Read", "bone-neutral": "Bone Neutral", "overcast-glare": "Overcast",
  "sandstone-sun": "Sandstone Sun",
};

// ============================================================
// 1) DATA - exactly the 10 session-35 ids carry `since`, nothing else does
// ============================================================
{
  const sinceIds = await page.evaluate(() => window.G.theme.THEMES.filter((t) => t.since).map((t) => t.id));
  const sortedActual = [...sinceIds].sort();
  const sortedExpected = [...FOCUS_SESSION_35].sort();
  JSON.stringify(sortedActual) === JSON.stringify(sortedExpected)
    ? ok(`exactly the 10 session-35 theme ids carry a \`since\` tag: ${sortedActual.join(", ")}`)
    : bad(`\`since\`-tagged ids don't match the session-35 set - got ${JSON.stringify(sortedActual)}, expected ${JSON.stringify(sortedExpected)}`);

  const sinceValue = await page.evaluate(() => window.G.theme.THEMES.find((t) => t.id === "graphite-calm").since);
  sinceValue === "session-35"
    ? ok(`graphite-calm's since value is the literal "session-35" (matches the source comment, not a guessed slug)`)
    : bad(`graphite-calm's since value was ${JSON.stringify(sinceValue)}, expected "session-35"`);
}

// ============================================================
// 2) UI WIRING - open the real wall, read the live DOM
// ============================================================
// The toggle's own accessible name changes on click ("Change theme ▾" ->
// "Hide theme picker ▴" - see its click handler in src/index.html), so a
// locator scoped to only the "before" text would stop resolving the moment
// it's clicked. Match either state instead of re-querying by the old name.
const toggle = page.getByRole("button", { name: /change theme|hide theme picker/i });
await toggle.waitFor({ state: "visible", timeout: 5000 });
const wrapDisplayBefore = await page.evaluate(() => {
  // tsToggle's row (tsRow) and themeWrap are both direct children of the
  // same Appearance <div.panel>, appended in that order (tsRow, then
  // themeWrap) - see the "Change theme ▾" toggle's construction in
  // src/index.html. The toggle button itself sits INSIDE tsRow, so its
  // parent's next sibling is the wall's own wrapper div.
  const t = [...document.querySelectorAll("button")].find((b) => /change theme/i.test(b.textContent));
  const wrap = t && t.parentElement && t.parentElement.nextElementSibling;
  return wrap ? getComputedStyle(wrap).display : null;
});
wrapDisplayBefore === "none"
  ? ok(`theme wall starts collapsed (display:none) - the exact gap this fix addresses (no signal visible until opened)`)
  : bad(`theme wall's starting display was "${wrapDisplayBefore}", expected "none"`);

await toggle.click();
await page.waitForTimeout(200);
(await toggle.getAttribute("aria-expanded")) === "true"
  ? ok("Change theme ▾ toggle opens the wall (aria-expanded flips to true)")
  : bad("Change theme toggle aria-expanded after click: " + (await toggle.getAttribute("aria-expanded")));

const badgeReport = await page.evaluate(() => {
  const rows = [];
  document.querySelectorAll(".theme-swatch-btn").forEach((btn) => {
    const nameEl = btn.querySelector(".tsb-name > span:first-child");
    const badge = btn.querySelector(".tsb-new");
    const visible = btn.offsetParent !== null;
    rows.push({
      name: nameEl ? nameEl.textContent : null,
      hasBadge: !!badge,
      badgeText: badge ? badge.textContent.trim() : null,
      visible,
    });
  });
  return rows;
});

badgeReport.length === 24
  ? ok(`theme wall rendered exactly 24 swatch buttons`)
  : bad(`theme wall rendered ${badgeReport.length} swatch buttons, expected 24`);

badgeReport.every((r) => r.visible)
  ? ok(`all 24 swatch buttons are actually on-screen (offsetParent set) after opening the wall - not just present in a hidden DOM`)
  : bad(`${badgeReport.filter((r) => !r.visible).length} swatch button(s) not actually visible after opening the wall`);

const badgedNames = badgeReport.filter((r) => r.hasBadge).map((r) => r.name);
badgedNames.length === 10
  ? ok(`exactly 10 swatch buttons show the New badge in the live picker`)
  : bad(`${badgedNames.length} swatch buttons show a New badge, expected 10: ${badgedNames.join(", ")}`);

const wrongText = badgeReport.filter((r) => r.hasBadge && r.badgeText !== "New");
wrongText.length === 0
  ? ok(`every rendered badge's text is exactly "New"`)
  : bad(`badge(s) with unexpected text: ${JSON.stringify(wrongText)}`);

// Name-by-name check against the session-35 THEME names (the DOM only
// carries t.name, not t.id), so a mismatch names exactly which one broke.
for (const id of FOCUS_SESSION_35) {
  const name = NAME_BY_ID[id];
  const row = badgeReport.find((r) => r.name === name);
  if (!row) { bad(`${name} (${id}): no matching swatch button found in the rendered wall at all`); continue; }
  row.hasBadge
    ? ok(`${name} (session-35): shows the New badge`)
    : bad(`${name} (session-35): MISSING the New badge`);
}

// Sample one theme from each OLDER wave - v0.42 shipped, v0.43 new
// palettes, v0.43 focus/attention, v0.43 high-contrast - proving the badge
// doesn't leak onto everything. A badge that shows on every theme is as
// useless as one that shows on none, and a naive `!!t.name` truthy check
// (instead of the real `!!t.since`) would pass every one of the ten
// positive assertions above while failing every one of these.
const OLDER_SAMPLE = ["Field Manual", "Squadron Blue", "Subdued", "Signal Amber"];
for (const name of OLDER_SAMPLE) {
  const row = badgeReport.find((r) => r.name === name);
  if (!row) { bad(`${name} (older wave): no matching swatch button found in the rendered wall at all`); continue; }
  !row.hasBadge
    ? ok(`${name} (older wave, no \`since\`): correctly shows NO New badge`)
    : bad(`${name} (older wave, no \`since\`): incorrectly shows a New badge`);
}

// ============================================================
// 3) ACCESSIBILITY - badge text is plain content, lands in the button's
//    own accessible name (not aria-hidden the way the checkmark icon is).
//    Uses Locator.ariaSnapshot(), which reflects the browser's REAL
//    accessible-name computation - not a raw-textContent approximation.
//    Raw textContent has no space between the adjacent <span> text nodes
//    (they're only visually separated by flex `gap`), so a naive string
//    check on it either false-fails on the run-together "CalmNew" or has
//    to fuzz-match around it. The accname algorithm inserts the word
//    boundaries a screen reader actually announces (confirmed empirically:
//    ariaSnapshot() renders this button as `"Graphite Calm New Neutral
//    graphite with one steel accent..."` — a real space before "New" and
//    after it), so asking the browser for its own answer is the only way
//    to test what AT users really hear.
// ============================================================
{
  const graphiteBtn = page.locator(".theme-swatch-btn", { hasText: "Graphite Calm" }).first();
  const graphiteSnap = await graphiteBtn.ariaSnapshot();
  /\bNew\b/.test(graphiteSnap)
    ? ok(`Graphite Calm's computed accessible name includes "New" as its own word (${JSON.stringify(graphiteSnap)}) - a screen reader gets the same signal a sighted Soldier gets from the badge's color`)
    : bad(`Graphite Calm's computed accessible name: ${JSON.stringify(graphiteSnap)}`);

  const fieldBtn = page.locator(".theme-swatch-btn", { hasText: "Field Manual" }).first();
  const fieldSnap = await fieldBtn.ariaSnapshot();
  !/\bNew\b/.test(fieldSnap)
    ? ok(`Field Manual's computed accessible name does NOT include "New" (older wave, correctly unbadged for AT users too)`)
    : bad(`Field Manual's computed accessible name unexpectedly includes "New": ${JSON.stringify(fieldSnap)}`);
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad(relevantNoise.length + " console msg(s); first: " + relevantNoise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `THEME NEW BADGE: ${fails} FAILURE(S)` : "THEME NEW BADGE: all passed"));
process.exit(fails ? 1 : 0);
