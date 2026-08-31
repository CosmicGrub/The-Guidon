/**
 * Roadmap audit round 5, "Test Coverage Gaps" bucket: the SITREP builder
 * (#/write's "SITREP" tab, renderSitrep()/printSitrep() in js "writing.js")
 * had zero UI-level test coverage. Grepping every test file in tools/ for
 * "SITREP" before writing this returned exactly one incidental mention (a
 * comment in test-write-memo-split.mjs about the sibling Memorandum tab),
 * never a test that actually opens the tab.
 *
 * sitrepState is a module-level in-memory object, loaded once from kv
 * "writing:drafts:v1" (WRITE_DRAFTS_KEY, shared with the Memorandum tab's
 * memoState under separate "memo"/"sitrep" keys) and persisted back via
 * persistWriteDraftsDebounced() - a 1500ms setTimeout also registered as
 * util.onFlush("writing:drafts", ...) so a backgrounded tab still saves.
 * This proves: a typed line survives a tab-away/tab-back round trip (the
 * in-memory object, independent of persistence timing), "Format & print
 * SITREP" produces real #print-holder content with the typed value baked
 * in, and the "Resume Example" tab (the 4th #/write tab, never otherwise
 * exercised by any test) renders cleanly.
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
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
// window.print() is stubbed up front - real print() can hang/behave oddly
// headless, and "Format & print SITREP" only needs the #print-holder DOM
// util.printHTML() builds before ever calling window.print() (same
// technique test-print-paths.mjs and test-write-memo-split.mjs both use).
await page.addInitScript(() => { window.print = () => {}; });
await page.evaluate(() => { window.print = () => {}; });
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(400);

// Clean slate regardless of anything a prior test left in this shared kv row.
await page.evaluate(() => window.G.db.setSetting("writing:drafts:v1", { memo: {}, sitrep: {} }));

await page.evaluate(() => { location.hash = "#/write"; });
await page.waitForTimeout(400);
await page.locator(".tabbar button", { hasText: /^SITREP$/ }).click();
await page.waitForTimeout(300);

// LINE 1's real label is "LINE 1 — Unit / callsign" (confirmed from the
// embedded seed data) - matching on "LINE 1" alone sidesteps the em dash.
const line1 = page.locator('.wr-row:has(label:has-text("LINE 1")) input');
(await line1.count()) === 1 ? ok("the SITREP form renders LINE 1's real input field") : bad("LINE 1 input count: " + (await line1.count()));

const LINE1_TEXT = "2nd SQD, 1st PLT — River Crossing Site";
await line1.fill(LINE1_TEXT);
await page.waitForTimeout(200);

// ==================== 1) Tab-away / tab-back round trip ====================
await page.locator(".tabbar button", { hasText: /^Bullet Builder$/ }).click();
await page.waitForTimeout(200);
await page.locator(".tabbar button", { hasText: /^SITREP$/ }).click();
await page.waitForTimeout(200);
const line1AfterTabRoundTrip = await page.locator('.wr-row:has(label:has-text("LINE 1")) input').inputValue();
line1AfterTabRoundTrip === LINE1_TEXT
  ? ok("a typed SITREP line survives switching to another tab and back (sitrepState is module-level, not per-render)")
  : bad("LINE 1 value after tab-away/tab-back: " + JSON.stringify(line1AfterTabRoundTrip));

// ==================== 2) "Format & print SITREP" produces real, escaped printed content ====================
// A second, HTML-special-character line proves the print path both carries
// real typed values AND escapes them - the same class of check
// test-print-paths.mjs's own header cites real prior bugs for on this
// module's sibling Memorandum print path.
const line2 = page.locator('.wr-row:has(label:has-text("LINE 2")) input');
const LINE2_TEXT = "<b>091430ZJUL26</b>";
await line2.fill(LINE2_TEXT);
await page.waitForTimeout(200);

await page.locator("button", { hasText: /Format & print SITREP/ }).click();
await page.waitForTimeout(500);
const sitrepPrint = await page.evaluate(() => {
  const h = document.querySelector("#print-holder");
  const html = h ? h.innerHTML : "";
  if (h) h.remove();
  return html;
});
/SITREP \(Practice\)/.test(sitrepPrint) ? ok("SITREP print produces real report content") : bad("SITREP print missing title: " + sitrepPrint.slice(0, 150));
sitrepPrint.includes(LINE1_TEXT) ? ok("the printed SITREP includes LINE 1's exact typed value") : bad("SITREP print missing LINE 1 text: " + sitrepPrint.slice(0, 300));
sitrepPrint.includes("&lt;b&gt;091430ZJUL26&lt;/b&gt;")
  ? ok("LINE 2's HTML-special-character text is escaped in the printed SITREP")
  : bad("escaped LINE 2 text not found in SITREP print: " + sitrepPrint.slice(0, 400));
sitrepPrint.includes("<b>091430ZJUL26</b>")
  ? bad("raw, unescaped LINE 2 markup leaked into the printed SITREP")
  : ok("the raw, unescaped LINE 2 markup is not present anywhere in the printed SITREP");

// ==================== 3) "Resume Example" tab smoke check ====================
await page.locator(".tabbar button", { hasText: /^Resume Example$/ }).click();
await page.waitForTimeout(300);
const resumeRendered = await page.evaluate(() => !!document.querySelector("#writing-stage") && (document.querySelector("#writing-stage").textContent || "").length > 50);
resumeRendered ? ok("the 'Resume Example' tab renders real content") : bad("Resume Example tab appears empty");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings across the SITREP form, print, and Resume Example tab") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

// cleanup
await page.evaluate(() => window.G.db.setSetting("writing:drafts:v1", { memo: {}, sitrep: {} }));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSITREP: all passed");
process.exit(fails ? 1 : 0);
