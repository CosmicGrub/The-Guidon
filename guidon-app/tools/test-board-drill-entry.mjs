/**
 * Board Drill opens ON THE CARD when the Soldier tapped "take me to my cards",
 * the filter rows no longer push the card off the screen on a stacked layout, and
 * the keyboard promise on the screen is true.
 *
 * WHY THIS SUITE EXISTS. Entering Board Drill from Home's "Drill ->" or "5-minute
 * board reps -> Start" left the flashcard below the fold: at 390x844 the card
 * started past the bottom navigation, and on a Z Fold5 unfolded (673px) the three
 * wrapping filter rows put it 455px below the screen with nothing bringing it
 * into view. Focus sat on the page heading, so the screen's "press Space" hint did
 * nothing (Space just scrolled the page) until the card was clicked.
 *
 * Three slices, in value-per-risk order:
 *   1. The three filter rows are one scrolling line each at EVERY width below the
 *      split grid (max-width 1023px), not only on phones (it stopped at 640px).
 *   2. A tap on Home's Drill / Start brings the card block into view (just far
 *      enough: the counter stays on screen, the Board Date panel and tab strip are
 *      not shoved off the top) and puts keyboard focus on the card - AFTER the
 *      screen-reader heading focus route() does, with one spoken sentence. The nav
 *      item, the tab strip, the category list and deep links do none of this.
 *   3. The shortcuts stay scoped to the card (never global - WCAG 2.1.4), and the
 *      screen's hint now says what a keyboard needs first instead of promising
 *      "press Space" from anywhere.
 *
 * Both directions are asserted: the arrival does what it should AND every other
 * way into the screen lands exactly where it did (scrollTop 0, focus on the
 * heading), and wide desktop rows still wrap.
 */
import { bootApp, ok, bad, check, finish, waitForRoute, until, clickWhenStable, liveCount, expectNoConsoleNoise } from "./testkit.mjs";
import { checkRowScrollsToEnd, checkFocusRingNeverClipped } from "./chip-row-assertions.mjs";

const is = (cond, claim, detail) => check(cond, claim, () => "NOT: " + claim + (detail === undefined ? "" : "  | " + (typeof detail === "function" ? detail() : detail)));
const report = (list) => { for (const r of list) (r.ok ? ok : bad)(r.msg); };
const BAR = (label) => `.search-filters[aria-label="Quick-filter by ${label}"]`;

const boot = await bootApp({ viewport: { width: 1280, height: 900 } });
const { page, noise } = boot;
await liveCount(page, { kind: "board" });
const setSize = (w, h) => page.setViewportSize({ width: w, height: h });
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let i = 0; const step = () => (++i >= n ? res() : requestAnimationFrame(step)); requestAnimationFrame(step); }), n);

const geometry = () => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
  const main = document.querySelector("main");
  const a = document.activeElement;
  const bars = ["pillar", "category", "regulation"].map((l) => document.querySelector('.search-filters[aria-label="Quick-filter by ' + l + '"]'));
  return {
    vw: innerWidth, vh: innerHeight,
    main: r(main), scrollTop: main ? Math.round(main.scrollTop) : -1,
    card: r(document.querySelector(".qz-card")), wrap: r(document.querySelector(".qz-wrap")),
    tally: r([...document.querySelectorAll(".stat")].find((x) => /This session/.test(x.textContent))),
    active: a ? a.tagName + (a.classList && a.classList.length ? "." + [...a.classList][0] : "") : null,
    activeText: a && a.tagName === "H2" ? a.textContent.trim() : "",
    rows: bars.map((b) => { if (!b) return null; const chip = b.querySelector(".search-chip"); const cs = getComputedStyle(b); return { h: Math.round(b.getBoundingClientRect().height), chipH: chip ? Math.round(chip.getBoundingClientRect().height) : 0, flexWrap: cs.flexWrap, overflowX: cs.overflowX }; }),
  };
});
const openRegulation = () => page.evaluate(() => { const d = document.querySelector(".qf-disclosure"); if (d) d.open = true; });
const goBoard = async (opts = {}) => {
  await waitForRoute(page, "#/board", Object.assign({ fresh: true, ready: ".qz-card" }, opts));
  await frames(4);
};
const goHome = () => waitForRoute(page, "#/home", { fresh: true, ready: "#route .stat" });
const clearSrs = () => page.evaluate(async () => {
  const rows = await G.db.all("kv");
  for (const r of rows) if (r && typeof r.k === "string" && r.k.indexOf("srs:") === 0) await G.db.del("kv", r.k);
});
const startCard = () => page.locator(".card.click", { hasText: /5-minute board reps/ });
const dueCard = () => page.locator(".card.click", { hasText: /board cards due for review/ });

/* ---------------------------------------------------------------------
   1. the filter rows are one scrolling line each below the split grid
   --------------------------------------------------------------------- */
for (const [w, h, label] of [[673, 841, "a Z Fold5 unfolded (673px)"], [720, 841, "720px"], [800, 841, "800px"], [1023, 841, "1023px, the last width before the split grid"]]) {
  await setSize(w, h);
  await goBoard();
  await openRegulation();
  await frames(2);
  const g = await geometry();
  is(g.rows.every((r) => r && r.flexWrap === "nowrap" && (r.overflowX === "auto" || r.overflowX === "scroll") && r.h < r.chipH * 1.8), "at " + label + " all three filter rows are one scrolling line each", () => JSON.stringify(g.rows));
  is(g.card && g.card.top <= g.vh - 100, "at " + label + " the flashcard starts at least 100px above the bottom of the screen (card top " + (g.card && g.card.top) + " of " + g.vh + ")", () => JSON.stringify(g.card));
  if (w === 673 || w === 800) {
    // The screen change cross-fades (a View Transition): while it runs, a pointer lands on the page root, not on the row, so a
    // wheel gesture would be wasted. Wait until the row can really be reached before using real input on it.
    for (const l of ["pillar", "category", "regulation"]) {
      const reachable = await until(page, (sel) => { const b = document.querySelector(sel); if (!b) return false; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && b.contains(e); }, BAR(l));
      is(reachable, "at " + w + "px the " + l + " row can be reached by a pointer once the screen has settled", () => "never");
    }
    for (const l of ["pillar", "category", "regulation"]) report(await checkRowScrollsToEnd(page, BAR(l), "at " + w + "px the " + l));
    for (const l of ["pillar", "category", "regulation"]) report(await checkFocusRingNeverClipped(page, BAR(l), "at " + w + "px the " + l));
  }
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  is(!overflowX, "at " + label + " the page has no horizontal overflow", () => "overflows");
}
{
  // honest path: from the split grid up, the rows keep wrapping exactly as before
  await setSize(1280, 900);
  await goBoard();
  const g = await geometry();
  is(g.rows.slice(0, 2).every((r) => r && r.flexWrap === "wrap" && r.overflowX === "visible"), "at 1280px (split grid) the filter rows still wrap, untouched", () => JSON.stringify(g.rows));
  await setSize(1024, 800);
  await goBoard();
  const g2 = await geometry();
  is(g2.rows.slice(0, 2).every((r) => r && r.flexWrap === "wrap" && r.overflowX === "visible"), "at exactly 1024px (the first split-grid width) the rows still wrap", () => JSON.stringify(g2.rows));
}

/* ---------------------------------------------------------------------
   2. arrival from Home: the card is on screen and has focus
   --------------------------------------------------------------------- */
const focusLogOn = () => page.evaluate(() => {
  window.__focusLog = [];
  window.__focusHook = (e) => { const t = e.target; window.__focusLog.push(t.tagName === "H2" ? "H2:" + t.textContent.trim() : t.tagName + "." + [...(t.classList || [])][0]); };
  document.addEventListener("focusin", window.__focusHook, true);
});
const focusLogOff = () => page.evaluate(() => { document.removeEventListener("focusin", window.__focusHook, true); const l = window.__focusLog; window.__focusLog = null; return l; });
const cardFocused = () => until(page, () => !!document.activeElement && document.activeElement.classList.contains("qz-wrap"), null);

async function arrive(label, size, enter) {
  await setSize(size[0], size[1]);
  await goHome();
  await focusLogOn();
  await enter();
  await waitForRoute(page, "#/board", { ready: ".qz-card" });
  const focused = await cardFocused();
  await frames(3);
  const g = await geometry();
  const log = await focusLogOff();
  is(focused && g.active === "DIV.qz-wrap", label + ": keyboard focus is on the card", () => JSON.stringify(g.active));
  const inside = (b) => b && g.main && b.top >= g.main.top - 1 && b.bottom <= g.main.bottom + 1;
  is(inside(g.card) && inside(g.wrap), label + ": the whole card block is inside the visible area (card " + JSON.stringify(g.card) + ", screen area " + JSON.stringify(g.main && [g.main.top, g.main.bottom]) + ")", () => JSON.stringify(g));
  // "just far enough": the counter above the card is still on screen, and the block either ends right at the bottom of the visible area
  // or was held back only because the counter would have left the top - never scrolled past what was needed (which would also push the
  // Board Date panel and the tab strip away for nothing)
  const hugsBottom = g.wrap && g.main && g.wrap.bottom >= g.main.bottom - 80;
  const heldByCounter = g.tally && g.main && g.tally.top <= g.main.top + 24;
  is(g.tally && g.main && g.tally.top >= g.main.top && (hugsBottom || heldByCounter), label + ": scrolled just far enough (counter still on screen, block ends at the bottom edge), not to the top of the card", () => JSON.stringify({ tally: g.tally, wrap: g.wrap, main: g.main }));
  const headingAt = log.findIndex((x) => x === "H2:Board Drill"), cardAt = log.lastIndexOf("DIV.qz-wrap");
  is(headingAt !== -1 && cardAt > headingAt && log[log.length - 1] === "DIV.qz-wrap", label + ": the heading was focused first (the screen-reader announcement), then the card, and focus stayed there", () => JSON.stringify(log));
  const said = await until(page, () => /card 1 of \d+/.test((document.getElementById("a11y-live") || {}).textContent || ""), null);
  const spoken = await page.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");
  is(said && /Press Space to flip, then 1 to 4 to grade/.test(spoken), label + ": one sentence says where focus went", JSON.stringify(spoken));
  const flagGone = await page.evaluate(() => G.board._arrive == null);
  is(flagGone, label + ": the one-shot arrival flag was consumed", () => "still set");
  return g;
}
async function flipAndGradeByKeyboard(label) {
  const before = await page.evaluate(() => { const s = [...document.querySelectorAll(".stat")].find((x) => /This session/.test(x.textContent)); const m = s && /recalled (\d+)\/(\d+)/.exec(s.textContent); return m ? +m[2] : -1; });
  await page.keyboard.press("Space");
  const flipped = await until(page, () => !!document.querySelector(".qz-card.flipped"), null);
  is(flipped, label + ": Space flips the card with no click first", () => "not flipped");
  await page.keyboard.press("3");
  const graded = await until(page, (b) => { const s = [...document.querySelectorAll(".stat")].find((x) => /This session/.test(x.textContent)); const m = s && /recalled (\d+)\/(\d+)/.exec(s.textContent); return !!m && +m[2] > b; }, before);
  is(graded, label + ": the 3 key then grades it (Know It)", () => "not graded");
}

await clearSrs();
for (const [w, h, name] of [[390, 844, "390x844 phone"], [360, 800, "360x800 phone"], [344, 882, "a Z Fold5 folded (344x882)"], [673, 841, "a Z Fold5 unfolded (673x841)"], [800, 841, "800x841"], [1280, 800, "1280x800 desktop"]]) {
  const g = await arrive("Start from Home at " + name, [w, h], () => clickWhenStable(page, startCard()));
  if (w === 390 || w === 673) await flipAndGradeByKeyboard("Start from Home at " + name);
  await clearSrs();
}

// "N board cards due -> Drill": the due card only shows with at least three due, so give it five
{
  await page.evaluate(async () => {
    const qs = G.store.boardQuestions().slice(0, 5); const now = Date.now();
    for (const q of qs) await G.db.put("kv", { k: "srs:" + q.id, v: { reps: 1, ease: 2.3, interval: 3, due: now - 60000, misses: 0, lastGrade: 2 } });
  });
  for (const [w, h, name] of [[390, 844, "390x844 phone"], [673, 841, "a Z Fold5 unfolded (673x841)"]]) {
    await arrive("Drill from Home's due card at " + name, [w, h], () => clickWhenStable(page, dueCard()));
    const dueOnly = await page.evaluate(() => { const c = document.querySelector(".due-chip:not(.leech-chip):not(.star-chip)"); return !!c && c.classList.contains("active"); });
    is(dueOnly, "Drill from Home's due card at " + name + ": it still opens the due-only deck (the filter flag is unchanged)", () => "due chip not active");
  }
  await clearSrs();
}

/* ---------------------------------------------------------------------
   arrival never pulls focus away from a control the Soldier already reached
   --------------------------------------------------------------------- */
{
  // The first card draw waits on a scan of the device's saved rows. A keyboard user can Tab onto a control in
  // that gap; the arrival step must then leave focus exactly where they put it. The scan is held here so the
  // gap is as long as the test needs, then released.
  await setSize(1280, 900);
  await clearSrs();
  await goHome();
  await page.evaluate(() => {
    const realAll = G.db.all;
    let release; const held = new Promise((r) => { release = r; });
    window.__releaseScan = () => { G.db.all = realAll; release(); };
    G.db.all = function (s) { return s === "kv" ? held.then(() => realAll.call(G.db, s)) : realAll.call(G.db, s); };
  });
  await clickWhenStable(page, startCard());
  const onHeading = await until(page, () => { const a = document.activeElement; return !!a && a.tagName === "H2" && /Board Drill/.test(a.textContent); }, null);
  const noCardYet = await page.evaluate(() => !document.querySelector(".qz-card"));
  await page.keyboard.press("Tab");
  const reached = await page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    window.__reached = a;
    return { tag: a.tagName, cls: [...(a.classList || [])][0] || "", type: a.type || "", label: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 40) };
  });
  is(onHeading && noCardYet && !!reached && !/qz-wrap/.test(reached.cls), "fixture: with the first draw held, focus was on the heading and a Tab reached a real control (" + JSON.stringify(reached) + ")", () => JSON.stringify({ onHeading, noCardYet, reached }));
  await page.evaluate(() => { const live = document.getElementById("a11y-live"); if (live) live.textContent = ""; window.__releaseScan(); });
  const drawn = await until(page, () => !!document.querySelector(".qz-card"), null);
  await frames(6);
  const held = await page.evaluate(() => ({ same: document.activeElement === window.__reached, onCard: !!document.activeElement && document.activeElement.classList.contains("qz-wrap"), said: (document.getElementById("a11y-live") || {}).textContent || "" }));
  is(drawn && held.same && !held.onCard, "once the card is drawn, focus is still on the control the Soldier tabbed to - the card did not take it", () => JSON.stringify(held));
  is(!/Press Space to flip/.test(held.said), "...and nothing was announced about focus moving to the card (it did not)", () => JSON.stringify(held.said));
  await clearSrs();
}

/* ---------------------------------------------------------------------
   everything else lands exactly where it did
   --------------------------------------------------------------------- */
{
  await setSize(390, 844);
  // the plain route (what the side or bottom navigation does)
  await goHome();
  await focusLogOn();
  await goBoard({ fresh: false });
  const g = await geometry();
  const log = await focusLogOff();
  is(g.scrollTop === 0 && g.active === "H2" && g.activeText === "Board Drill", "opening Board Drill from the navigation does not scroll and leaves focus on the heading (scrollTop " + g.scrollTop + ", focus " + g.active + ")", () => JSON.stringify(g));
  is(!log.includes("DIV.qz-wrap"), "and the card never took focus", () => JSON.stringify(log));
  // a category deep link
  const cat = await page.evaluate(() => G.store.boardQuestions()[0].category);
  await goHome();
  await page.evaluate((c) => { G.board._filterCat = c; }, cat);
  await goBoard({ fresh: false });
  const g2 = await geometry();
  is(g2.scrollTop === 0 && g2.active === "H2", "a category deep link does not scroll or move focus either", () => JSON.stringify(g2));

  // a stale flag (set but never consumed, ten seconds ago) must not fire on a later, unrelated visit
  await goHome();
  await page.evaluate(() => { G.board._arrive = Date.now() - 10000; });
  await goBoard({ fresh: false });
  const g3 = await geometry();
  is(g3.scrollTop === 0 && g3.active === "H2", "a stale arrival flag (ten seconds old) does nothing", () => JSON.stringify(g3));

  // tab strip: switching away and back to Board Drill is not an arrival
  await page.evaluate(() => { document.querySelector("main").scrollTop = 0; });
  await clickWhenStable(page, page.locator(".segmented button", { hasText: /^Quiz$/ }));
  await clickWhenStable(page, page.locator(".segmented button", { hasText: /^Board Drill$/ }));
  await until(page, () => !!document.querySelector(".qz-card"), null);
  await frames(4);
  const g4 = await geometry();
  is(g4.scrollTop === 0 && g4.active !== "DIV.qz-wrap", "coming back to Board Drill from the Quiz tab neither scrolls nor takes focus", () => JSON.stringify(g4));

  // a keyboard user who has not selected the card yet: Space does not flip it (last, because Space scrolls the page)
  await goHome();
  await goBoard({ fresh: false });
  const gH = await geometry();
  is(gH.active === "H2", "a plain visit leaves focus on the heading", () => JSON.stringify(gH));
  await page.keyboard.press("Space");
  await frames(2);
  const notFlipped = await page.evaluate(() => !document.querySelector(".qz-card.flipped"));
  is(notFlipped, "Space with focus on the heading does not flip the card (the shortcuts stay scoped to the card, not global)");
}

/* ---------------------------------------------------------------------
   3. the screen's hint states what a keyboard needs first
   --------------------------------------------------------------------- */
{
  await setSize(1280, 900);
  await goBoard();
  const hints = await page.evaluate(() => [...document.querySelectorAll("#route p.hint")].map((p) => p.textContent.replace(/\s+/g, " ").trim()).filter((t) => /grade yourself 1-4/.test(t)));
  is(hints.length === 1 && /Skip to flashcard/.test(hints[0]) && !/or press Space\)/.test(hints[0]), "the screen hint names Skip to flashcard as the keyboard's first step and no longer promises Space from anywhere", () => JSON.stringify(hints));
  const skipLink = await page.evaluate(() => { const b = [...document.querySelectorAll("button.skip-link")].find((x) => /Skip to flashcard/.test(x.textContent)); return !!b; });
  is(skipLink, "and the Skip to flashcard control the hint names exists", () => "missing");
}

expectNoConsoleNoise(noise);
await finish("BOARD DRILL ENTRY");
