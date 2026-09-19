/**
 * Board content truth - one bank, one true answer.
 *
 * The board supplement and the two "gap" card packs (src/app-modules/
 * 00-/01-/06-/07-*.js) are added to the seed's question bank at page load,
 * AFTER every seed lint has run - so nothing checked that what they teach
 * agrees with the publication they cite, or with the seed card sitting next
 * to them in the same category. A multi-agent audit found the deck teaching
 * two different answers to the same board question in several places. Every
 * assertion here is about the ASSEMBLED bank the running app really serves
 * (seed + every content pack), read from the live page, and the card-back
 * checks go through the real Board Drill UI (category filter -> Next card ->
 * Flip card) rather than reading source text.
 *
 * Editions verified 2026-09-19 against the Army Publishing Directorate PDFs:
 *   TC 3-22.9 (13 May 2016, incl. C3 20 Nov 2019), paras 1-6 to 1-14
 *
 * Each section names the audit finding it guards (C16, C19, ...), and each
 * was confirmed to FAIL against main @ 6d5d004 before its fix landed.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForFunction(() => window.G && G.store && G.store.boardQuestions().length > 900, null, { timeout: 30000 });

/* The assembled bank exactly as every consumer sees it. */
const bank = await page.evaluate(() => G.store.boardQuestions().map((q) => ({
  id: q.id, category: q.category, q: q.q, a: q.a, acceptableAnswer: q.acceptableAnswer || "", boardAnswer: q.boardAnswer || "",
  keyPoints: q.keyPoints || [], source: q.source || "", concept: q.concept || "", pillar: q.pillar || null,
  verbatim: q.verbatim, mos: q.mos || null, sourceCards: q.sourceCards || [],
})));
const doctrine = await page.evaluate(() => (window.GUIDON_SEED.doctrine.entries || []).map((d) => ({ id: d.id, title: d.title, body: d.body, source: d.source, confidence: d.confidence, keyPoints: d.keyPoints || [] })));
const textOf = (q) => [q.q, q.a, q.acceptableAnswer, q.boardAnswer, q.concept].concat(q.keyPoints).join(" \n ");

/* Open one specific card in the real Board Drill and flip it. Returns the
   back face as the Soldier sees it: every answer block's heading + text, the
   Source line, and the key points. */
async function openCardBack(card) {
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(250);
  await page.evaluate((cat) => { G.board._filterCat = cat; location.hash = "#/board"; }, card.category);
  await page.waitForSelector(".qz-front .qz-prompt", { timeout: 15000 });
  const poolSize = bank.filter((q) => q.category === card.category).length;
  for (let i = 0; i <= poolSize + 1; i++) {
    const prompt = await page.evaluate(() => { const p = document.querySelector(".qz-front .qz-prompt"); return p ? p.textContent.trim() : null; });
    if (prompt === card.q) {
      await page.click('button[aria-label="Flip card"]');
      await page.waitForTimeout(150);
      return page.evaluate(() => {
        const back = document.querySelector(".qz-back");
        const blocks = Array.from(back.querySelectorAll(".bq-answer-block")).map((b) => ({
          label: (b.querySelector(".bq-answer-label") || {}).textContent || "",
          text: (b.querySelector(".bq-answer-text") || {}).textContent || "",
          src: (b.querySelector(".src") || {}).textContent || "",
        }));
        const kp = Array.from(back.querySelectorAll(".bq-kp-list li")).map((li) => li.textContent);
        return { blocks, kp, all: back.textContent.replace(/\s+/g, " ") };
      });
    }
    await page.click('button[aria-label="Next card"]');
    await page.waitForTimeout(40);
  }
  return null;
}

/* ---- C16: the four weapon safety rules (TC 3-22.9, paras 1-6 to 1-14) ---- */
console.log("\nC16 - weapon safety rules say what TC 3-22.9 says");
{
  const rulesCards = bank.filter((q) => /four weapons? safety rules/i.test(q.q));
  rulesCards.length >= 1 ? ok(`${rulesCards.length} card(s) ask for the four weapon safety rules: ${rulesCards.map((q) => q.id).join(", ")}`) : bad("no card asks for the four weapon safety rules");
  const wrong = bank.filter((q) => /on safe until|safe until (you|ready)/i.test(textOf(q)));
  wrong.length === 0 ? ok('no card teaches "keep the weapon on safe until..." as a safety rule (that is the USMC wording, not TC 3-22.9)') : bad("cards still teaching the on-safe rule: " + wrong.map((q) => q.id).join(", "));
  for (const c of rulesCards) {
    /positive identification|positively identify/i.test(c.a + " " + c.boardAnswer) ? ok(`${c.id}: Rule 4 is positive identification of the target and its surroundings`) : bad(`${c.id}: Rule 4 is not TC 3-22.9's - "${c.a}"`);
    const back = await openCardBack(c);
    if (!back) { bad(`${c.id}: could not reach the card in Board Drill (category "${c.category}")`); continue; }
    (/positive identification|positively identify/i.test(back.all) && !/on safe until/i.test(back.all))
      ? ok(`${c.id}: the flipped card in Board Drill shows Rule 4 as positive identification`)
      : bad(`${c.id}: Board Drill back face reads: ${back.all.slice(0, 260)}`);
  }
  const d = doctrine.find((x) => x.id === "doc-weapons-1");
  (d && /positive identification of the target and its surroundings/i.test(d.body) && !/keep the weapon on SAFE/i.test(d.body))
    ? ok("doctrine entry doc-weapons-1 lists TC 3-22.9's four rules (Rule 4 = positive identification)")
    : bad("doc-weapons-1 body: " + (d ? d.body.slice(0, 200) : "missing"));
  (d && d.source && d.source.para === "1-6 to 1-14") ? ok("...and cites the paragraphs the rules are in (1-6 to 1-14)") : bad("doc-weapons-1 source: " + JSON.stringify(d && d.source));
}

/* ---- zero console noise ---- */
console.log("");
noise.length === 0 ? ok("zero console errors/warnings across the run") : bad("console noise: " + noise.slice(0, 5).join(" | "));

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
