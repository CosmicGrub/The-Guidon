/**
 * Roadmap Tier 5 (width-utilization audit), #/career + #/leader:
 *
 * #/career's NCOES/Promotion Ladder (career.js's nsPanel) rendered its 7
 * grade-transition cards as one full-width row after another, on every
 * viewport including a 1360px desktop - confirmed by direct measurement
 * before this fix (7 cards, 7 distinct row tops, full container width,
 * at 1024px). Now wrapped in the same .card-results-grid utility half a
 * dozen other routes already share (dictionary.js's own results,
 * curriculum's lesson list, resilience's domain/skill cards, transition's
 * step cards) rather than a new bespoke grid.
 *
 * #/leader's Squad Roster is the audit's "(latent)" case: EMPTY by default
 * for a fresh install, so the stacking-waste only exists once a real
 * roster has entries - this test seeds several through the app's own real
 * "+ Add Soldier" / field-edit / Remove CRUD (src/app-modules/leader.js),
 * not a synthetic data injection, and confirms the previously-empty state
 * still renders its correct empty-state copy unchanged by the grid CSS.
 *
 * Both fixes reuse .card-results-grid's existing auto-fill/minmax(260px,1fr)
 * unconditionally - no new @media breakpoint was introduced by either fix,
 * so there is nothing here to check against the canonical breakpoint scale;
 * the "distinct row top" assertions below are what prove the grid is real
 * at the CSS level, at both a real wide viewport and a real narrow one.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const page = await context.newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
// Roadmap-week audit (3rd pass), following the #app-inert fix: a fresh
// profile-less context boots straight into onboarding, which now correctly
// marks #app inert while it's open (see util._pushModalInert's own
// comment). Every check above the MOS-search sanity check below only ever
// reads DOM geometry (querySelectorAll/getBoundingClientRect), which
// inert doesn't affect - but the MOS-search step is a real interaction
// (fill()) inside #app, and that silently no-ops while inert blocks it.
// Seeded a completed profile so onboarding never launches, matching every
// other test's established convention (see test-biometric-lock.mjs).
await page.evaluate(async () => {
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
    displayName: "SGT GRIDTEST", lastName: "GRIDTEST", anonymous: false,
    studyWeakPoints: [], readinessConcerns: [], actionPlan: [], promoPoints: {},
  } });
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);

async function cardGeometry(selector) {
  return page.evaluate((sel) => {
    const nodes = [...document.querySelectorAll(sel)];
    const rects = nodes.map((n) => n.getBoundingClientRect());
    return {
      count: nodes.length,
      tops: rects.map((r) => Math.round(r.top)),
      lefts: rects.map((r) => Math.round(r.left)),
      widths: rects.map((r) => Math.round(r.width)),
    };
  }, selector);
}

// ============================================================ #/career ====

await page.setViewportSize({ width: 768, height: 900 });
await page.evaluate(() => { location.hash = "#/career"; });
await page.waitForTimeout(600);

const careerWide = await cardGeometry(".dict-entry-card");
careerWide.count === 7
  ? ok("CAREER @768px: all 7 NCOES ladder cards present")
  : bad("CAREER @768px: expected 7 .dict-entry-card, found " + careerWide.count);
// Real row-sharing proof: the first two cards' top edges match, i.e. they
// sit in the SAME grid row side by side, not stacked one above the other.
(careerWide.count >= 2 && careerWide.tops[0] === careerWide.tops[1] && careerWide.lefts[0] !== careerWide.lefts[1])
  ? ok("CAREER @768px: cards 1 and 2 share a row (same top " + careerWide.tops[0] + "px, different left " + careerWide.lefts[0] + "/" + careerWide.lefts[1] + ")")
  : bad("CAREER @768px: cards did not share a row - tops " + JSON.stringify(careerWide.tops) + " lefts " + JSON.stringify(careerWide.lefts));
(careerWide.widths[0] < 500)
  ? ok("CAREER @768px: card width (" + careerWide.widths[0] + "px) is roughly half the panel, not full-width")
  : bad("CAREER @768px: card width still full-width (" + careerWide.widths[0] + "px)");

// Narrow viewport must stay a clean single column - same route, no regression.
await page.setViewportSize({ width: 375, height: 800 });
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(150);
await page.evaluate(() => { location.hash = "#/career"; });
await page.waitForTimeout(600);
const careerNarrow = await cardGeometry(".dict-entry-card");
const distinctTopsNarrow = new Set(careerNarrow.tops).size;
(careerNarrow.count === 7 && distinctTopsNarrow === 7)
  ? ok("CAREER @375px: all 7 ladder cards stay single-column (7 distinct row positions)")
  : bad("CAREER @375px: expected 7 distinct rows for 7 cards, got " + distinctTopsNarrow + " (tops " + JSON.stringify(careerNarrow.tops) + ")");

// Sanity: the MOS search (untouched code, same page) still works - the
// ladder fix only touched nsPanel's own card loop, nothing else on the route.
await page.setViewportSize({ width: 1024, height: 900 });
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(150);
await page.evaluate(() => { location.hash = "#/career"; });
await page.waitForTimeout(500);
await page.locator('input[aria-label="MOS code"]').fill("11B");
await page.waitForTimeout(400);
const searchText = await page.evaluate(() => document.body.textContent || "");
/11B — Infantryman/.test(searchText)
  ? ok("CAREER: MOS search still works after the ladder grid change (11B result renders)")
  : bad("CAREER: MOS search for 11B did not render its result card");

// ============================================================= #/leader ===

// --- truly empty roster: confirm the empty-state copy is unaffected ---
await page.evaluate(() => { location.hash = "#/leader"; });
await page.waitForTimeout(600);
const empty = await page.evaluate(() => ({
  heading: (document.querySelector("#view h2, main h2") || {}).textContent,
  noOneYet: /No one on the roster yet/.test(document.body.textContent || ""),
  cardCount: document.querySelectorAll("[data-roster-idx]").length,
}));
(empty.heading === "Squad Roster" && empty.noOneYet && empty.cardCount === 0)
  ? ok("LEADER: genuinely-empty roster still renders 'No one on the roster yet' with zero cards")
  : bad("LEADER empty-state check failed: " + JSON.stringify(empty));

// --- seed 3 real roster entries through the app's own CRUD (Add Soldier +
// field edits), not synthetic data injection - the exact ask for this route. ---
const addSoldier = () => page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /add soldier/i.test(x.textContent || ""));
  if (b) b.click();
});
for (let i = 0; i < 3; i++) { await addSoldier(); await page.waitForTimeout(150); }
await page.waitForTimeout(400);

const initials = ["ALFA", "BRAVO", "CHARLIE"];
await page.evaluate((names) => {
  const set = (el, val) => { el.value = val; el.dispatchEvent(new Event("change", { bubbles: true })); };
  const cards = [...document.querySelectorAll("[data-roster-idx]")];
  cards.forEach((card, i) => {
    set(card.querySelector('input[aria-label^="Rank for roster entry"]'), "SGT");
    set(card.querySelector('input[aria-label^="Initials or roster number"]'), names[i]);
  });
}, initials);
await page.waitForTimeout(500);

const namedOk = await page.evaluate(() =>
  [...document.querySelectorAll("[data-roster-idx]")]
    .map((c) => (c.querySelector('input[aria-label^="Initials or roster number"]') || {}).value));
JSON.stringify(namedOk) === JSON.stringify(initials)
  ? ok("LEADER: 3 roster entries seeded through real Add Soldier + field edits (ALFA/BRAVO/CHARLIE)")
  : bad("LEADER: seeded initials came back as " + JSON.stringify(namedOk));

// --- No date-input overflow at ANY canonical width once gridded: caught
// live during this fix - .panel-grid-2's fixed "1fr 1fr" (no minimum) let
// a native <input type="date"> (real min-content ~151px) spill past its
// own card by up to 63px once cardsGrid narrowed cards to 2-3 up. Fixed by
// giving fieldsGrid its own inline auto-fit/minmax(150px,1fr) override
// (leader.js) instead of touching the shared .panel-grid-2 class. Checked
// at every canonical breakpoint, not just 768/375, since the failure was
// width-dependent in a way neither of those alone would have caught. ---
async function worstDateOverflow() {
  return page.evaluate(() => {
    let worst = 0;
    [...document.querySelectorAll("[data-roster-idx]")].forEach((c) => {
      const r = c.getBoundingClientRect();
      [...c.querySelectorAll('input[type="date"]')].forEach((inp) => {
        const over = Math.round(inp.getBoundingClientRect().right - r.right);
        if (over > worst) worst = over;
      });
    });
    return worst;
  });
}
let worstOverflowSeen = 0;
for (const w of [375, 420, 480, 600, 640, 768, 799, 800, 1024, 1200, 1360, 1500]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(200);
  const over = await worstDateOverflow();
  if (over > worstOverflowSeen) worstOverflowSeen = over;
}
worstOverflowSeen === 0
  ? ok("LEADER: no date-input overflows its own roster card at any canonical breakpoint (375-1500px)")
  : bad("LEADER: a date input overflowed its card by " + worstOverflowSeen + "px at some canonical width");

// --- @768px: cards genuinely grid 2-up (same real-row proof as career) ---
await page.setViewportSize({ width: 768, height: 900 });
await page.waitForTimeout(300);
const leaderWide = await cardGeometry("[data-roster-idx]");
(leaderWide.count === 3 && leaderWide.tops[0] === leaderWide.tops[1] && leaderWide.lefts[0] !== leaderWide.lefts[1])
  ? ok("LEADER @768px: roster cards 1 and 2 share a row (same top " + leaderWide.tops[0] + "px, left " + leaderWide.lefts[0] + "/" + leaderWide.lefts[1] + ")")
  : bad("LEADER @768px: roster cards did not share a row - " + JSON.stringify(leaderWide));
(leaderWide.widths[0] < 450)
  ? ok("LEADER @768px: roster card width (" + leaderWide.widths[0] + "px) is roughly half the panel, not full-width")
  : bad("LEADER @768px: roster card width still full-width (" + leaderWide.widths[0] + "px)");

// --- @375px: same route, must stay a clean single column ---
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const leaderNarrow = await cardGeometry("[data-roster-idx]");
const distinctTopsLeaderNarrow = new Set(leaderNarrow.tops).size;
(leaderNarrow.count === 3 && distinctTopsLeaderNarrow === 3)
  ? ok("LEADER @375px: all 3 roster cards stay single-column (3 distinct row positions)")
  : bad("LEADER @375px: expected 3 distinct rows, got " + distinctTopsLeaderNarrow + " (tops " + JSON.stringify(leaderNarrow.tops) + ")");

// --- CRUD still fully intact once gridded: Remove the MIDDLE entry (index
// 1, "BRAVO"), confirm the confirm-dialog still gates it, and that the
// SURVIVING two entries are the correct ones (not an off-by-one from the
// cardsGrid re-parenting done by this fix). ---
await page.setViewportSize({ width: 768, height: 900 });
await page.waitForTimeout(300);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll("[data-roster-idx]")];
  const bravoCard = cards.find((c) => /BRAVO/.test((c.querySelector('input[aria-label^="Initials or roster number"]') || {}).value || ""));
  const del = bravoCard && [...bravoCard.querySelectorAll("button")].find((b) => /^Remove$/.test((b.textContent || "").trim()));
  if (del) del.click();
});
await page.waitForTimeout(400);
const modalUp = await page.evaluate(() => !!document.querySelector(".gm-back"));
modalUp ? ok("LEADER: Remove still opens a confirm dialog inside the gridded layout") : bad("LEADER: Remove did not confirm before deleting");
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".gm-back button")].find((x) => /remove/i.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(500);
const survivors = await page.evaluate(() =>
  [...document.querySelectorAll("[data-roster-idx]")]
    .map((c) => (c.querySelector('input[aria-label^="Initials or roster number"]') || {}).value));
(survivors.length === 2 && survivors.includes("ALFA") && survivors.includes("CHARLIE") && !survivors.includes("BRAVO"))
  ? ok("LEADER: removing the middle gridded card removes the right entry (ALFA + CHARLIE survive, BRAVO gone)")
  : bad("LEADER: survivors after removing BRAVO were " + JSON.stringify(survivors));

// --- reload persistence, still gridded, still correct ---
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
await page.evaluate(() => { location.hash = "#/leader"; });
await page.waitForTimeout(700);
const afterReload = await page.evaluate(() =>
  [...document.querySelectorAll("[data-roster-idx]")]
    .map((c) => (c.querySelector('input[aria-label^="Initials or roster number"]') || {}).value));
(afterReload.length === 2 && afterReload.includes("ALFA") && afterReload.includes("CHARLIE"))
  ? ok("LEADER: the 2 surviving gridded entries persist across reload")
  : bad("LEADER: after reload entries were " + JSON.stringify(afterReload));

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `CAREER-LEADER-GRID: ${fails} FAILURE(S)` : "CAREER-LEADER-GRID: all passed"));
process.exit(fails ? 1 : 0);
