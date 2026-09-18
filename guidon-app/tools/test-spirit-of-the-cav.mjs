/**
 * Spirit of the CAV integration regression coverage.
 * Verifies the runtime module feeds canonical Board Drill/Quiz content,
 * Recitation Drill, Creeds & Branch Identities, and progressive cloze data.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

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
await dismissOnboarding(page);
await page.waitForTimeout(250);

const truth = await page.evaluate(() => {
  const board = window.GUIDON_SEED.board.questions || [];
  const full = board.find((q) => q.id === "creed-spirit-of-the-cav");
  const related = board.filter((q) => /Spirit of the CAV|Gary Owen|First Team/.test((q.q || "") + " " + (q.concept || "")));
  const creed = (window.GUIDON_SEED.creeds || []).find((c) => c.id === "creed-spirit-of-the-cav");
  return {
    full: full ? {
      id: full.id,
      category: full.category,
      lineCount: Array.isArray(full.lines) ? full.lines.length : 0,
      source: full.source,
      hasFullText: /We are the CAV/.test(full.a || "") && /sound the charge/.test(full.a || "")
    } : null,
    relatedCount: related.length,
    creed: creed ? {
      linkedBoardId: creed.linkedBoardId,
      status: creed.source && creed.source.status,
      branch: creed.branch
    } : null,
    cloze: window.G.spiritOfTheCav && window.G.spiritOfTheCav.cloze
  };
});

truth.full && truth.full.category === "Creeds" && truth.full.lineCount === 8 && truth.full.hasFullText
  ? ok("full Spirit of the CAV recitation record exists with 8 ordered lines")
  : bad("missing or malformed full recitation record: " + JSON.stringify(truth.full));

truth.relatedCount >= 10
  ? ok("line-by-line/fill-in/history prompts were merged into canonical board.questions")
  : bad("expected at least 10 Spirit-related board prompts, found " + truth.relatedCount);

truth.creed && truth.creed.linkedBoardId === "creed-spirit-of-the-cav" && truth.creed.status === "unit-tradition" && truth.creed.branch === "Cavalry"
  ? ok("Creeds & Branch Identities entry cross-links to the recitable record and is labeled unit-tradition")
  : bad("creed/reference entry malformed: " + JSON.stringify(truth.creed));

truth.cloze && /______/.test(truth.cloze.easy) && /______/.test(truth.cloze.medium) && /W a t C/.test(truth.cloze.hard)
  ? ok("easy, medium, and first-letter hard memorization surfaces are available")
  : bad("progressive cloze data missing/malformed: " + JSON.stringify(truth.cloze));

const recitableHas = await page.evaluate(() => window.G.store.recitable().some((q) => q.id === "creed-spirit-of-the-cav"));
recitableHas
  ? ok("store.recitable() includes Spirit of the CAV automatically")
  : bad("Spirit of the CAV did not enter Recitation Drill's canonical store");

await page.evaluate(() => { location.hash = "#/recite"; });
await page.waitForTimeout(400);
const reciteRow = await page.evaluate(() =>
  [...document.querySelectorAll(".list-detail-list .ldr-name")].some((el) => /Spirit of the CAV/.test(el.textContent || ""))
);
reciteRow ? ok("#/recite visibly lists Spirit of the CAV") : bad("#/recite does not list Spirit of the CAV");

await page.evaluate(() => { location.hash = "#/creeds"; });
await page.waitForTimeout(400);
const creedRow = await page.evaluate(() =>
  [...document.querySelectorAll(".list-detail-list .ldr-name")].some((el) => /Spirit of the CAV/.test(el.textContent || ""))
);
creedRow ? ok("#/creeds visibly lists Spirit of the CAV") : bad("#/creeds does not list Spirit of the CAV");

const relevantNoise = noise.filter((n) => !/favicon/.test(n) && !/board supplement intake incomplete/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSPIRIT OF THE CAV: all passed");
process.exit(fails ? 1 : 0);
