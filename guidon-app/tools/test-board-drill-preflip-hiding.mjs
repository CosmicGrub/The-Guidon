/**
 * Product decision: Board Drill's mastery bar and LEECH badge must not
 * appear on the FRONT (pre-recall) face of the flashcard. Showing "how well
 * you've done on this" before the user has attempted recall primes their
 * self-assessment - the same UX risk Anki's own reviewer avoids by hiding
 * ease/interval/lapse data until after "Show Answer". They now render on
 * the BACK (post-flip) face instead, at the top, ahead of the answer
 * content. Category label, difficulty badge, and the due/new status text
 * ("due · N× reviewed" / "next in Nd · N× reviewed" / "new") are legitimate
 * framing - what kind of question this is, not a signal about how well the
 * user personally has done on it - so they stay on the front, unchanged.
 *
 * This suite seeds a real leeched srs: row (misses >= 4, G.board.isLeech's
 * own threshold - same seeding technique test-weak-areas.mjs uses) for one
 * specific board question, then drives the real UI: finds that exact card
 * (same category-narrow + "Next card" walk test-board-drill-face-parity.mjs
 * uses), inspects it BEFORE flipping, flips it for real, then inspects it
 * again.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
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

// Pick a target question that also carries a real difficulty tag, so the
// difficulty-badge regression check below is actually exercising something
// (falls back to the very first question if none happen to have one).
const target = await page.evaluate(() => {
  const qs = window.G.store.boardQuestions();
  const withDiff = qs.find((q) => q.difficulty && G.board.normDifficulty(q.difficulty));
  const t = withDiff || qs[0];
  return {
    id: t.id, category: t.category, q: t.q,
    difficulty: t.difficulty ? G.board.normDifficulty(t.difficulty) : null,
  };
});

// Seed a real leech: misses >= 4 is G.board.isLeech()'s own threshold (same
// value test-weak-areas.mjs seeds). reps:5/due:0/no lastGrade yields
// masteryState "learning" (not "new", not "mastered") with all 5 segments
// filled - a mid-range case that exercises both the bar's fill count and
// its non-"new" class.
await page.evaluate(async (id) => {
  await window.G.db.put("kv", { k: "srs:" + id, v: { reps: 5, ease: 2.3, interval: 1, due: 0, misses: 5 } });
}, target.id);

await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1100);

// Narrow to the target's own category and force a fresh build() so it
// re-reads the srs: row we just wrote (build() re-runs loadAllSrs on every
// category-select change - see src/index.html's renderDrill).
await page.evaluate((cat) => {
  const sel = document.querySelector('select[aria-label="Filter by category"]');
  if (sel) { sel.value = cat; sel.dispatchEvent(new Event("change")); }
}, target.category);
await page.waitForTimeout(300);

async function findByPrompt(targetQ, maxIter) {
  for (let i = 0; i < maxIter; i++) {
    const prompt = await page.evaluate(() => document.querySelector(".qz-prompt")?.textContent || "");
    if (prompt === targetQ) return true;
    await page.evaluate(() => { document.querySelector('button[aria-label="Next card"]')?.click(); });
    await page.waitForTimeout(60);
  }
  return false;
}

const hasCard = await page.evaluate(() => !!document.querySelector(".qz-wrap"));
hasCard ? ok("#/board renders a real flashcard (.qz-wrap present)") : bad("#/board: no flashcard rendered");

const found = hasCard && await findByPrompt(target.q, 250);
found ? ok("found the seeded leeched question in its category's deck") : bad("could not locate the seeded question (category '" + target.category + "')");

if (found) {
  const preFlip = await page.evaluate(() => {
    const front = document.querySelector(".qz-front");
    return {
      frontHasLeech: !!front.querySelector(".leech-badge"),
      frontHasMasteryBar: !!front.querySelector(".qz-mastery-bar"),
      kcLabel: front.querySelector(".kc-label")?.textContent || "",
      diffBadge: front.querySelector(".qz-diff-badge")?.textContent || null,
    };
  });

  // ---- Pre-flip: performance signals must be gone from .qz-front ----
  preFlip.frontHasLeech
    ? bad("PRE-FLIP: .leech-badge is present in .qz-front - it must only appear on the back, post-flip")
    : ok("PRE-FLIP: .leech-badge is NOT present in .qz-front");
  preFlip.frontHasMasteryBar
    ? bad("PRE-FLIP: .qz-mastery-bar is present in .qz-front - it must only appear on the back, post-flip")
    : ok("PRE-FLIP: .qz-mastery-bar is NOT present in .qz-front");

  // ---- Pre-flip regression guard: legitimate framing stays on the front ----
  const catEsc = target.category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  new RegExp(catEsc).test(preFlip.kcLabel) && /due/.test(preFlip.kcLabel) && /5× reviewed/.test(preFlip.kcLabel)
    ? ok("PRE-FLIP: category + due/reviewed status text is intact in .qz-front's .kc-label: \"" + preFlip.kcLabel + "\"")
    : bad("PRE-FLIP: .kc-label missing expected category/status text: \"" + preFlip.kcLabel + "\"");
  if (target.difficulty) {
    preFlip.diffBadge
      ? ok("PRE-FLIP: difficulty badge is intact in .qz-front: \"" + preFlip.diffBadge + "\"")
      : bad("PRE-FLIP: difficulty badge missing from .qz-front despite the question having difficulty '" + target.difficulty + "'");
  }

  // ---- Flip the real card (click, matching test-board-drill-face-parity.mjs) ----
  await page.evaluate(() => document.querySelector(".qz-card").click());
  await page.waitForTimeout(900);
  const flipped = await page.evaluate(() => !!document.querySelector(".qz-card.flipped"));
  flipped ? ok("card flipped") : bad("card did not flip - cannot check the back face");

  if (flipped) {
    const postFlip = await page.evaluate(() => {
      const front = document.querySelector(".qz-front");
      const back = document.querySelector(".qz-back");
      const leech = back.querySelector(".leech-badge");
      const bar = back.querySelector(".qz-mastery-bar");
      const srOnly = back.querySelector(".sr-only");
      return {
        leechText: leech ? leech.textContent : null,
        barIsLearning: bar ? bar.classList.contains("qz-mastery-learning") : null,
        filledCount: bar ? bar.querySelectorAll(".qz-mastery-seg.filled").length : null,
        srOnlyText: srOnly ? srOnly.textContent : null,
        kcLabel: front.querySelector(".kc-label")?.textContent || "",
        diffBadge: front.querySelector(".qz-diff-badge")?.textContent || null,
        frontHasLeechAfter: !!front.querySelector(".leech-badge"),
        frontHasMasteryBarAfter: !!front.querySelector(".qz-mastery-bar"),
      };
    });

    // ---- Post-flip: both signals now live on .qz-back, with correct content ----
    postFlip.leechText && /LEECH/.test(postFlip.leechText) && /5×/.test(postFlip.leechText)
      ? ok("POST-FLIP: .leech-badge is present in .qz-back with the real miss count: \"" + postFlip.leechText + "\"")
      : bad("POST-FLIP: .leech-badge missing or wrong content in .qz-back: " + JSON.stringify(postFlip.leechText));
    postFlip.barIsLearning
      ? ok("POST-FLIP: .qz-mastery-bar is present in .qz-back with the correct 'learning' state")
      : bad("POST-FLIP: .qz-mastery-bar missing from .qz-back, or not in the expected 'learning' state");
    postFlip.filledCount === 5
      ? ok("POST-FLIP: mastery bar shows 5 of 5 filled segments, matching the seeded reps")
      : bad("POST-FLIP: mastery bar shows " + postFlip.filledCount + " filled segments, expected 5");
    postFlip.srOnlyText === "Mastery: Learning, 5 of 5"
      ? ok("POST-FLIP: sr-only mastery text reads sensibly on the answer face: \"" + postFlip.srOnlyText + "\"")
      : bad("POST-FLIP: sr-only mastery text is \"" + postFlip.srOnlyText + "\", expected \"Mastery: Learning, 5 of 5\"");

    // ---- Post-flip regression guard: the moved elements did NOT also
    // leak back onto (or stay duplicated on) the front, and the front's
    // own unchanged content is still exactly as it was pre-flip. ----
    postFlip.frontHasLeechAfter
      ? bad("POST-FLIP: .leech-badge is (still/also) present in .qz-front")
      : ok("POST-FLIP: .qz-front still has no .leech-badge");
    postFlip.frontHasMasteryBarAfter
      ? bad("POST-FLIP: .qz-mastery-bar is (still/also) present in .qz-front")
      : ok("POST-FLIP: .qz-front still has no .qz-mastery-bar");
    postFlip.kcLabel === preFlip.kcLabel
      ? ok("POST-FLIP: .kc-label text is unchanged by flipping")
      : bad("POST-FLIP: .kc-label changed from \"" + preFlip.kcLabel + "\" to \"" + postFlip.kcLabel + "\"");
    postFlip.diffBadge === preFlip.diffBadge
      ? ok("POST-FLIP: difficulty badge is unchanged by flipping")
      : bad("POST-FLIP: difficulty badge changed from \"" + preFlip.diffBadge + "\" to \"" + postFlip.diffBadge + "\"");
  }
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nBOARD DRILL PRE-FLIP HIDING: all passed");
process.exit(fails ? 1 : 0);
