/**
 * #/search's card-render loop reading h.meta (roadmap Tier 3 batch 2 audit
 * finding): all 6 of runSearch()'s hit-builders (scenario/board/doctrine/
 * lesson/resource/career, this file's src/index.html) compute a real
 * per-domain h.meta - scenario's tier, board/resource's category, career's
 * board-status, doctrine's own source citation - but the render loop right
 * below them never read h.meta at all, so it was computed and silently
 * discarded on every single hit, every domain, forever. Separately, doctrine's
 * own hit-builder had a live shape bug hiding behind that same drop: doctrine
 * entries' `source` field is an OBJECT ({ref, para, asOf, ...} - see
 * store.doctrine()'s own query filter and views.doctrine's draw(), both in
 * this file), not a string like every other domain's meta, so the pre-fix
 * `meta: e.source||""` assigned the raw object. It only read as harmless
 * because nothing ever displayed it - the instant a render path started
 * reading h.meta, doctrine hits would have printed the literal string
 * "[object Object]" on every card.
 *
 * This test proves both are actually fixed together: a real search that
 * returns hits from several different domains (including doctrine) renders
 * a real, non-empty, correctly-formatted .search-hit-meta line per hit that
 * has one, and "[object Object]" appears nowhere on the results pane -
 * checked with a broad substring sweep across the WHOLE pane, not just the
 * doctrine cards, so a future domain developing the same mistake (assigning
 * an object where meta expects a string) would also be caught here.
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
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1100);
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1100);
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(500);

// "army" is a broad, generic Army-leadership term that (against the real
// seed data) returns hits in every one of the 6 SECTION_ORDER groups at
// once, including doctrine with a non-empty source citation - verified by
// manual exploration against this exact build before writing this test.
await page.evaluate(() => {
  const inp = document.querySelector('input[type="search"]');
  inp.focus();
  inp.value = "army";
  inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(400);

const snapshot = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".search-hit")];
  const byType = {};
  const allMetaTexts = [];
  cards.forEach((c) => {
    const label = c.getAttribute("aria-label") || "";
    const type = label.split(":")[0].trim();
    const metaEl = c.querySelector(".search-hit-meta");
    const subEl = c.querySelector(".search-hit-sub");
    const entry = {
      meta: metaEl ? metaEl.textContent : null,
      sub: subEl ? subEl.textContent : null,
    };
    (byType[type] = byType[type] || []).push(entry);
    if (metaEl) allMetaTexts.push(metaEl.textContent);
  });
  return {
    totalCards: cards.length,
    types: Object.keys(byType),
    byType,
    allMetaTexts,
    // innerText (not textContent) deliberately - textContent would also
    // pick up the inline <script> source itself (this whole app is one
    // inline script), which is not rendered page content and would false-
    // positive on comments/strings that merely mention the phrase.
    bodyHasObjectObject: document.body.innerText.includes("[object Object]"),
  };
});

snapshot.totalCards > 5
  ? ok(`query "army" rendered ${snapshot.totalCards} result cards`)
  : bad(`query "army" only rendered ${snapshot.totalCards} cards - not enough for a meaningful multi-domain check`);

const domainsPresent = snapshot.types.filter((t) => ["scenario", "board", "doctrine", "lesson", "resource", "career"].includes(t));
domainsPresent.length >= 3 && domainsPresent.includes("doctrine")
  ? ok(`results span ${domainsPresent.length} domains including doctrine: ${domainsPresent.join(", ")}`)
  : bad(`results span only ${domainsPresent.length} domains (${domainsPresent.join(", ")}) - need >=3 including doctrine`);

// The core regression check: h.meta is now actually rendered (not silently
// dropped) - every domain that computes a non-empty meta should produce a
// real .search-hit-meta element somewhere in its group.
["scenario", "board", "doctrine", "resource", "career"].forEach((type) => {
  const entries = snapshot.byType[type] || [];
  const withMeta = entries.filter((e) => e.meta !== null && e.meta.trim() !== "");
  withMeta.length > 0
    ? ok(`${type} hits render a real .search-hit-meta line (e.g. "${withMeta[0].meta}")`)
    : bad(`${type} hits never render a .search-hit-meta line - h.meta still being dropped for this domain (found ${entries.length} ${type} hit(s): ${JSON.stringify(entries)})`);
});

// The doctrine-specific shape-bug check: doctrine's meta must be a clean,
// short citation string (its source.ref), never the coerced object.
const docEntries = (snapshot.byType["doctrine"] || []).filter((e) => e.meta !== null && e.meta.trim() !== "");
if (docEntries.length) {
  const bad_ = docEntries.filter((e) => /\[object Object\]/.test(e.meta) || e.meta.length > 40);
  bad_.length === 0
    ? ok(`doctrine .search-hit-meta is a real citation string, not a coerced object (samples: ${docEntries.slice(0,3).map(e=>JSON.stringify(e.meta)).join(", ")})`)
    : bad(`doctrine .search-hit-meta looks wrong: ${JSON.stringify(bad_)}`);
} else {
  bad("no doctrine hit had a non-empty meta to check the shape-bug fix against");
}

// Broad regression net: "[object Object]" must not appear ANYWHERE in the
// results pane, not just on doctrine cards - catches the same class of bug
// in any domain, present or future.
snapshot.allMetaTexts.every((t) => !/\[object Object\]/.test(t))
  ? ok(`no .search-hit-meta text contains "[object Object]" (${snapshot.allMetaTexts.length} meta line(s) checked)`)
  : bad(`found "[object Object]" in a .search-hit-meta line: ${JSON.stringify(snapshot.allMetaTexts.filter((t) => /\[object Object\]/.test(t)))}`);

!snapshot.bodyHasObjectObject
  ? ok('no "[object Object]" text anywhere on the #/search page body')
  : bad('"[object Object]" found somewhere on the #/search page body');

noise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + noise.join(" | "));

await browser.close();
server.close();

console.log(fails === 0 ? "\nSEARCH HIT META: all passed" : `\nSEARCH HIT META: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
