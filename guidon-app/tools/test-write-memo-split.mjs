/**
 * Tier 5 width-waste fix, #/write (Writing Skills Trainer) - Memorandum tab.
 *
 * The route-by-route audit's claim: the AR 25-50 rules panel ("anatomy" of
 * a correct Army memo - office symbol/date, MEMORANDUM FOR, SUBJECT,
 * numbered body, POC, signature block) and the actual field-by-field editor
 * were always stacked full-width in renderMemo() (js "writing.js" section
 * of src/index.html), even on desktop/tablet widths with ample room to
 * show them side by side - forcing scrolling back and forth between
 * reading a rule and applying it in the form below.
 *
 * Re-measured live before fixing (see the worktree's own investigation,
 * not restated here): confirmed real, not stale - .wr-rules and .wr-form
 * were two independent full-width blocks, stacked, at every viewport
 * tested including 1440px desktop.
 *
 * Fix: both panels now live inside a shared .wr-memo-layout wrapper (see
 * renderMemo) that becomes a real 2-column CSS grid at >=1024px (the
 * canonical breakpoint closest to "genuinely wide desktop/tablet") - rules
 * pinned narrow-left via position:sticky, form free to grow on the right -
 * and stays the existing single-column stack below 1024px, unchanged.
 *
 * This test proves, against the real built web/index.html (not a mock):
 *   1) at 1280px, .wr-rules and .wr-form genuinely share a row (same top,
 *      non-overlapping X ranges - not just "both present in the DOM")
 *   2) the editor's real functionality still works post-restructure: text
 *      typed into a field survives a tab-away/tab-back round trip (the
 *      module-level memoState closure, untouched by the DOM wrap), and
 *      the real "Format & print memo" button still drives the real
 *      util.printHTML() pipeline (appends #print-holder with the typed
 *      field's value baked into the printed markup)
 *   3) at 375px (mobile), the two panels are still stacked in one column,
 *      exactly as before this change - the >=1024px split must not leak
 *      narrower than its own breakpoint
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function openMemoTab(page) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(700);
  const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCard.count()) {
    await guestCard.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = "#/write"; });
  await page.waitForTimeout(400);
  await page.locator(".tabbar button", { hasText: /^Memorandum$/ }).click();
  await page.waitForTimeout(300);
}

function rect(el) {
  return el.boundingBox();
}

// ---------------------------------------------------------------------
// 1) Wide viewport (1280x900, above the 1024px breakpoint): real 2-pane
//    split, not just "both elements present".
// ---------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
  page.on("pageerror", (e) => noise.push(e.message));

  await openMemoTab(page);

  const layoutDisplay = await page.evaluate(() => getComputedStyle(document.querySelector(".wr-memo-layout")).display);
  layoutDisplay === "grid" ? ok("wide (1280px): .wr-memo-layout is a real CSS grid (computed display:grid)") : bad("wide: .wr-memo-layout display is " + layoutDisplay + ", expected grid");

  const rulesBox = await rect(page.locator(".wr-rules"));
  const formBox = await rect(page.locator(".wr-form"));
  if (!rulesBox || !formBox) {
    bad("wide: could not measure .wr-rules/.wr-form bounding boxes");
  } else {
    const sameRow = Math.abs(rulesBox.y - formBox.y) < 4;
    const nonOverlappingX = (rulesBox.x + rulesBox.width) <= formBox.x + 1; // rules ends at/before form starts
    sameRow ? ok(`wide: .wr-rules and .wr-form share a row (top ${Math.round(rulesBox.y)} vs ${Math.round(formBox.y)})`) : bad(`wide: rows differ - rules top ${rulesBox.y}, form top ${formBox.y}`);
    nonOverlappingX ? ok(`wide: .wr-rules (x ${Math.round(rulesBox.x)}-${Math.round(rulesBox.x + rulesBox.width)}) sits left of .wr-form (x ${Math.round(formBox.x)}-${Math.round(formBox.x + formBox.width)}), no overlap`) : bad(`wide: X ranges overlap - rules ${JSON.stringify(rulesBox)} form ${JSON.stringify(formBox)}`);
  }

  // Reference pane is pinned via position:sticky, not stretched/duplicated.
  const rulesPosition = await page.evaluate(() => getComputedStyle(document.querySelector(".wr-rules")).position);
  rulesPosition === "sticky" ? ok("wide: .wr-rules is position:sticky (pinned reference pane)") : bad("wide: .wr-rules position is " + rulesPosition + ", expected sticky");

  // ---- existing functionality: field text survives a tab-away/back ----
  const subjectInput = page.locator(".wr-form .wr-row", { hasText: /^SUBJECT$/ }).locator("input");
  await subjectInput.fill("QA Width-Waste Regression Test");
  await page.locator(".tabbar button", { hasText: /^Bullet Builder$/ }).click();
  await page.waitForTimeout(200);
  await page.locator(".tabbar button", { hasText: /^Memorandum$/ }).click();
  await page.waitForTimeout(200);
  const subjectAfterRoundTrip = await page.locator(".wr-form .wr-row", { hasText: /^SUBJECT$/ }).locator("input").inputValue();
  subjectAfterRoundTrip === "QA Width-Waste Regression Test"
    ? ok("editor functionality intact: SUBJECT field survives a Bullet-Builder/Memorandum tab round trip")
    : bad("SUBJECT field after tab round trip: " + JSON.stringify(subjectAfterRoundTrip));

  // ---- existing functionality: print pipeline still wired up ----
  await page.locator(".wr-form .wr-row", { hasText: /^SUBJECT$/ }).locator("input").fill("QA Print Check Subject");
  await page.evaluate(() => { window.print = () => { window.__qaPrinted = true; }; }); // stub window.print, keep printHTML's own DOM/logic real
  await page.locator("button.btn.primary", { hasText: /Format & print memo/ }).click();
  await page.waitForTimeout(300);
  const printState = await page.evaluate(() => ({
    printed: !!window.__qaPrinted,
    holderText: document.getElementById("print-holder")?.textContent || "",
  }));
  printState.printed ? ok("Format & print memo still invokes the real print pipeline (window.print() called)") : bad("window.print() was not invoked");
  printState.holderText.includes("QA Print Check Subject")
    ? ok("printed markup reflects the real typed SUBJECT field value")
    : bad("print-holder content missing typed SUBJECT text: " + printState.holderText.slice(0, 200));

  noise.length === 0 ? ok("wide: no console errors") : bad("wide: console errors: " + noise.slice(0, 3).join(" | "));
  await ctx.close();
}

// ---------------------------------------------------------------------
// 2) Exactly at the breakpoint (1024x900): split must already be active
//    (min-width:1024px is inclusive).
// ---------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const page = await ctx.newPage();
  await openMemoTab(page);
  const layoutDisplay = await page.evaluate(() => getComputedStyle(document.querySelector(".wr-memo-layout")).display);
  layoutDisplay === "grid" ? ok("at breakpoint (1024px exactly): split is active") : bad("at 1024px: .wr-memo-layout display is " + layoutDisplay + ", expected grid");
  await ctx.close();
}

// ---------------------------------------------------------------------
// 3) Narrow/mobile viewport (375x812): original stacked single-column
//    behavior must be unchanged.
// ---------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await openMemoTab(page);

  const layoutDisplay = await page.evaluate(() => getComputedStyle(document.querySelector(".wr-memo-layout")).display);
  layoutDisplay === "block" ? ok("narrow (375px): .wr-memo-layout stays display:block (no grid)") : bad("narrow: .wr-memo-layout display is " + layoutDisplay + ", expected block");

  const rulesPosition = await page.evaluate(() => getComputedStyle(document.querySelector(".wr-rules")).position);
  (rulesPosition === "static" || rulesPosition === "")
    ? ok("narrow: .wr-rules is not pinned (position:static, unchanged)")
    : bad("narrow: .wr-rules position is " + rulesPosition + ", expected static");

  const rulesBox = await rect(page.locator(".wr-rules"));
  const formBox = await rect(page.locator(".wr-form"));
  const stacked = formBox.y >= rulesBox.y + rulesBox.height - 2; // form starts at/after rules ends
  const fullWidthEach = Math.abs(rulesBox.width - formBox.width) < 2; // both span the same (full) column width
  stacked ? ok(`narrow: .wr-form (top ${Math.round(formBox.y)}) is stacked below .wr-rules (bottom ${Math.round(rulesBox.y + rulesBox.height)}), unchanged`) : bad(`narrow: not stacked - rules ${JSON.stringify(rulesBox)} form ${JSON.stringify(formBox)}`);
  fullWidthEach ? ok(`narrow: .wr-rules and .wr-form share the same full column width (~${Math.round(rulesBox.width)}px)`) : bad(`narrow: widths differ - rules ${rulesBox.width} form ${formBox.width}`);

  await ctx.close();
}

console.log(fails === 0 ? "\nWRITE MEMO SPLIT: all passed" : `\nWRITE MEMO SPLIT: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
