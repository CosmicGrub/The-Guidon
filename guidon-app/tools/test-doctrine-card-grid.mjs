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
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(1100);
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

console.log(fails === 0 ? "\nDOCTRINE CARD GRID: all passed" : `\nDOCTRINE CARD GRID: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
