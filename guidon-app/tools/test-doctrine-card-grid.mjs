/**
 * Roadmap Tier 5 width-waste fix, #/doctrine: the up-to-DOC_CAP=150
 * multi-paragraph doctrine cards used to stack in one flat column no
 * matter how wide the .list-detail results pane got - confirmed live
 * before this fix (not assumed from the roadmap's own older audit figure):
 * every one of the first 10 cards had a UNIQUE bounding-rect Y at every
 * viewport tried, including a 1500px desktop width where the results pane
 * alone measured 824px wide, and .main's real scrollHeight there was
 * ~36,091px.
 *
 * The fix wraps the actual doc-entry-card elements in a nested
 * .card-results-grid (the same shared grid utility Resources/Dictionary/
 * Board Drill's picker/Readiness domain grid etc. already use - see that
 * class' own comment near line 4901 in src/index.html) rather than putting
 * the grid class on `results` itself, so the "N entries" header and the
 * DOC_CAP-truncation hint stay full-width block siblings instead of being
 * squeezed into a single grid cell. This test proves, with real measured
 * geometry (not a hardcoded "before" number):
 *   - at >=768px, multiple cards now share a row (same top edge)
 *   - toggling the SAME grid back to single-column at the SAME viewport,
 *     with the SAME real seed content, measurably grows .main's
 *     scrollHeight - a true live before/after, not a mocked baseline
 *   - the topic filter (activeDocTopic) still narrows the card set
 *     correctly with the new nested-grid DOM shape
 *   - the board-question "Related doctrine" cross-link
 *     (G.views._doctrineSeed -> pre-filled search) still works
 *   - at 375px the grid's own auto-fill collapses back to a clean single
 *     column - the fix must not regress the narrow-viewport layout
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function boot(viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.evaluate(() => { location.hash = "#/doctrine"; });
  await page.waitForTimeout(700);
  return { page, noise };
}

/* ---- >=768px: multiple cards actually share a row ---- */
for (const width of [768, 1280]) {
  const { page, noise } = await boot({ width, height: 900 });
  const info = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".doc-entry-card"));
    const rects = cards.slice(0, 6).map((c) => Math.round(c.getBoundingClientRect().top));
    const grid = document.querySelector(".card-results-grid");
    return {
      cardCount: cards.length,
      rects,
      gridDisplay: grid ? getComputedStyle(grid).display : null,
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
    };
  });
  info.gridDisplay === "grid"
    ? ok(`${width}px: .card-results-grid wrapping the doctrine cards is display:grid`)
    : bad(`${width}px: expected .card-results-grid display "grid", got "${info.gridDisplay}"`);
  const sameRowPair = info.rects[0] === info.rects[1];
  sameRowPair
    ? ok(`${width}px: card 0 and card 1 share the same row (top=${info.rects[0]}px both) - real multi-column layout, not stacked`)
    : bad(`${width}px: card 0 (top=${info.rects[0]}) and card 1 (top=${info.rects[1]}) do NOT share a row - still stacked`);
  noise.length === 0 ? ok(`${width}px: no console errors/warnings loading #/doctrine`) : bad(`${width}px console noise: ${noise.join(" | ")}`);
  await page.close();
}

/* ---- real measured scrollHeight: grid vs the SAME content forced single-column ---- */
{
  const { page } = await boot({ width: 1500, height: 900 });
  const before = await page.evaluate(() => {
    const main = document.querySelector(".main");
    return main ? main.scrollHeight : null;
  });
  const after = await page.evaluate(() => {
    const grid = document.querySelector(".card-results-grid");
    grid.style.gridTemplateColumns = "1fr"; // force the pre-fix single-column shape, same DOM/content
    const main = document.querySelector(".main");
    void main.offsetHeight; // force reflow before reading
    return main.scrollHeight;
  });
  after > before
    ? ok(`1500px: forcing the real grid back to single-column grows .main.scrollHeight (${before}px -> ${after}px) - the grid genuinely shortens the page, not a mocked comparison`)
    : bad(`1500px: forcing single-column did not grow scrollHeight (${before}px -> ${after}px) - grid may not be doing real work`);
  await page.close();
}

/* ---- topic filter still narrows the (now nested-grid) card set ---- */
{
  const { page } = await boot({ width: 1280, height: 900 });
  const before = await page.evaluate(() => document.querySelectorAll(".doc-entry-card").length);
  const chipInfo = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll(".search-filters .search-chip"));
    const chip = chips.find((c, i) => i > 0); // first real topic chip, not "All topics"
    if (!chip) return null;
    const label = chip.textContent;
    chip.click();
    return label;
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const badges = Array.from(document.querySelectorAll(".doc-topic-badge")).map((b) => b.textContent);
    return { count: document.querySelectorAll(".doc-entry-card").length, badges };
  });
  chipInfo
    ? ok(`1280px: clicked topic chip "${chipInfo}"`)
    : bad("1280px: no topic chip found to click (expected >=1 topic with >=2 entries)");
  (chipInfo && after.count > 0 && after.count <= before)
    ? ok(`1280px: topic filter narrowed the card set (${before} -> ${after.count} cards)`)
    : bad(`1280px: topic filter did not narrow correctly (${before} -> ${after.count} cards)`);
  const topicName = chipInfo ? chipInfo.replace(/\s*\(\d+\)\s*$/, "") : null;
  const allMatch = topicName ? after.badges.every((b) => b === topicName) : false;
  allMatch
    ? ok(`1280px: every visible card's topic badge matches the active filter ("${topicName}")`)
    : bad(`1280px: some visible cards don't match the active topic filter "${topicName}": ${JSON.stringify(after.badges.slice(0, 5))}`);
  await page.close();
}

/* ---- board-question "Related doctrine" cross-link still pre-fills search ---- */
{
  const { page } = await boot({ width: 1280, height: 900 });
  const seedResult = await page.evaluate(async () => {
    window.G.views._doctrineSeed = "AR 600-20";
    location.hash = "#/home"; // navigate away first so setting #/doctrine again below fires a real hashchange + re-render
    await new Promise((r) => setTimeout(r, 200));
    location.hash = "#/doctrine";
    await new Promise((r) => setTimeout(r, 500));
    const search = document.querySelector('input[aria-label="Search doctrine"]');
    return { value: search ? search.value : null, seedCleared: window.G.views._doctrineSeed === null };
  });
  seedResult.value === "AR 600-20"
    ? ok(`Related-doctrine cross-link: search box pre-filled with "${seedResult.value}"`)
    : bad(`Related-doctrine cross-link: expected search box "AR 600-20", got "${seedResult.value}"`);
  seedResult.seedCleared
    ? ok("Related-doctrine cross-link: views._doctrineSeed consumed (cleared) after use")
    : bad("Related-doctrine cross-link: views._doctrineSeed was not cleared after use");
  await page.close();
}

/* ---- 375px: still a clean single column, no regression ---- */
{
  const { page, noise } = await boot({ width: 375, height: 812 });
  const info = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".doc-entry-card"));
    const rects = cards.slice(0, 6).map((c) => Math.round(c.getBoundingClientRect().top));
    const uniqueTops = new Set(rects).size;
    const grid = document.querySelector(".card-results-grid");
    return { count: cards.length, uniqueTops, rectCount: rects.length,
      gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : null };
  });
  info.uniqueTops === info.rectCount
    ? ok(`375px: all ${info.rectCount} sampled cards have distinct top edges - clean single column preserved`)
    : bad(`375px: expected ${info.rectCount} distinct row tops, got ${info.uniqueTops} - cards unexpectedly sharing rows on a phone viewport`);
  noise.length === 0 ? ok("375px: no console errors/warnings") : bad(`375px console noise: ${noise.join(" | ")}`);
  await page.close();
}

/* ---- list-detail jump still lands a DEEP card in the viewport ----
 * Regression guard for the .doc-entry-card content-visibility:auto pass
 * (desktop roadmap S1): jumpToDocEntry (src/index.html, views.doctrine)
 * scrollIntoView()s the card matching a clicked .list-detail-row and pulses
 * it with .list-detail-jumped. content-visibility:auto skips layout for
 * off-screen cards, and a scrollIntoView aimed at a not-yet-rendered card
 * whose size is only an estimate can land short. So: click the LAST row
 * (the card farthest from the initial viewport, off-screen before the
 * click at every viewport), poll the card's top every 100ms until it has
 * held still for three consecutive GENUINE samples (measured live: the
 * default smooth scroll over the ~37k/~72k px .main scroller settles at
 * ~1.4-1.5s, so a fixed short wait reads a mid-flight position and fails
 * spuriously; hard cap 8s of real elapsed time). "Genuine" matters because
 * this poll runs via setTimeout inside the SAME page whose main thread a
 * concurrent test run can starve: under contention, setTimeout callbacks
 * coalesce and fire back-to-back with no repaint between them, so two
 * "identical" reads either side of a stall prove the page was frozen, not
 * that the animation settled (reproduced: a full 149-suite run failed here
 * at settleMs=400 with the card still 700+px short; the same suite alone
 * passes every time) - each poll's real elapsed gap is measured and a read
 * only counts toward stability when that gap is close to the requested
 * 100ms. Then assert with real geometry that the card's top edge
 * is inside the viewport and that most of it is visible. The pulse class
 * is read synchronously right after the click, because jumpToDocEntry
 * removes it again at 1600ms - within the same window the smooth scroll
 * is still settling. Both a wide viewport (row list beside the cards) and
 * a phone viewport (row list stacked above them, where the skipped-layout
 * window is largest) are covered. */
for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 780 }]) {
  const { page, noise } = await boot(viewport);
  const r = await page.evaluate(async () => {
    const rows = Array.from(document.querySelectorAll(".list-detail-row"));
    const cardCount = document.querySelectorAll(".doc-entry-card").length;
    const idx = rows.length - 1;
    const row = rows[idx];
    const card = document.querySelector('[data-doc-idx="' + idx + '"]');
    if (!row || !card) return { rows: rows.length, cardCount, missing: true };
    const before = card.getBoundingClientRect();
    row.click();
    const jumped = card.classList.contains("list-detail-jumped");
    let last = null, stable = 0, settleMs = 0, prevT = performance.now();
    for (let i = 0; i < 60 && stable < 3 && settleMs < 8000; i++) {
      await new Promise((res) => setTimeout(res, 100));
      const nowT = performance.now();
      const gap = nowT - prevT;
      prevT = nowT;
      settleMs += gap;
      const top = Math.round(card.getBoundingClientRect().top);
      // gap far above the requested 100ms means this tick was coalesced/
      // delayed by main-thread contention - not proof the animation held
      // still, so it can't count toward the 3-in-a-row stability streak.
      const genuineTick = gap < 250;
      stable = (genuineTick && top === last) ? stable + 1 : 0;
      last = top;
    }
    settleMs = Math.round(settleMs);
    const rect = card.getBoundingClientRect();
    const visible = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
    return {
      rows: rows.length, cardCount, idx, settleMs,
      beforeTop: Math.round(before.top),
      top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height),
      innerHeight,
      visibleFrac: rect.height > 0 ? visible / Math.min(rect.height, innerHeight) : 0,
      jumped,
      cv: getComputedStyle(card).contentVisibility,
    };
  });
  const tag = `${viewport.width}px jump-to-last (idx ${r.idx}, content-visibility=${r.cv})`;
  (!r.missing && r.rows === r.cardCount && r.rows >= 2)
    ? ok(`${tag}: ${r.rows} index rows match ${r.cardCount} cards`)
    : bad(`${tag}: index rows (${r.rows}) vs cards (${r.cardCount}) mismatch or missing`);
  if (!r.missing) {
    r.beforeTop >= r.innerHeight
      ? ok(`${tag}: card started off-screen (top=${r.beforeTop}px, innerHeight=${r.innerHeight}) - the jump has real work to do`)
      : bad(`${tag}: card was already on-screen before the click (top=${r.beforeTop}px) - the jump is not being exercised`);
    (r.top >= 0 && r.top < r.innerHeight)
      ? ok(`${tag}: card top edge inside the viewport after the jump settled at ${r.settleMs}ms (top=${r.top}px, bottom=${r.bottom}px, innerHeight=${r.innerHeight})`)
      : bad(`${tag}: card top edge NOT inside the viewport after the jump settled at ${r.settleMs}ms (top=${r.top}px, bottom=${r.bottom}px, innerHeight=${r.innerHeight})`);
    r.visibleFrac >= 0.5
      ? ok(`${tag}: ${Math.round(r.visibleFrac * 100)}% of the card (height ${r.height}px) is visible`)
      : bad(`${tag}: only ${Math.round(r.visibleFrac * 100)}% of the card (height ${r.height}px) is visible - scrollIntoView landed short`);
    r.jumped
      ? ok(`${tag}: card carried .list-detail-jumped immediately after the click`)
      : bad(`${tag}: card did NOT carry .list-detail-jumped immediately after the click`);
  }
  noise.length === 0 ? ok(`${tag}: no console errors/warnings`) : bad(`${tag} console noise: ${noise.join(" | ")}`);
  await page.close();
}

console.log(fails === 0 ? "\nDOCTRINE CARD GRID: all passed" : `\nDOCTRINE CARD GRID: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
