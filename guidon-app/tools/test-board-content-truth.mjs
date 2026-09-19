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
 *   TC 7-22.7 Figure 7 (the Creed), via seed card creed-4's line-by-line copy
 *   AR 735-5 (30 Apr 2026) paras 4-7c, 4-10, 6-1..6-5, 7-2, 7-3  [DA Form 7923; no DD Form 362]
 *   AR 710-4 (15 Apr 2026) chapter 3, paras 3-1..3-3  [CSDP]; AR 710-2 (1 Jul 2024) para 2-3
 *   AR 600-85 (4 Oct 2024) para 1-7  ["While not a part of ASAP, SUDCC ..."]
 *   AR 608-1 (26 May 2026) paras 1-1, 1-8  [retitled Soldier and Family Readiness]
 *   AR 930-4 (15 Apr 2026) para 1-18g
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

/* ---- C19: the NCO Creed is an official text - quote it exactly or not at all ---- */
console.log("\nC19 - the NCO Creed is quoted exactly, and nothing is put in its mouth");
{
  /* The line-by-line copy the accuracy project verified against TC 7-22.7,
     Figure 7 - the one place in the bank that holds the whole Creed. */
  const creedLines = await page.evaluate(() => (G.store.boardQuestions().find((q) => q.id === "creed-4") || {}).lines || []);
  creedLines.length === 20 ? ok("creed-4 carries the full 20-line Creed to check quotations against") : bad("creed-4.lines has " + creedLines.length + " lines");
  const creedText = creedLines.join(" ");
  !/carry out/i.test(creedText) ? ok('the Creed itself has no "carry out ... orders" line') : bad("creed-4 contains a carry-out-orders line?");
  /* No card may present "carry out the orders" as something the Creed says -
     the one card that mentions the phrase must be the one that debunks it. */
  const carry = bank.filter((q) => /NCO Creed|Creeds/.test(q.category) && /carry out (the|their) orders/i.test(textOf(q)));
  const misattrib = carry.filter((q) => !/not in the Creed|never says|no 'carry out the orders' line/i.test(textOf(q)));
  misattrib.length === 0 ? ok("no Creed card attributes an obedience line to the Creed") : bad("cards attributing 'carry out the orders' to the Creed: " + misattrib.map((q) => q.id).join(", "));
  /* Every card asking what the Creed says/requires about officers gives the real passage. */
  const officerCards = bank.filter((q) => /NCO Creed/i.test(q.q) && /\bofficers\b/i.test(q.q) && /(say|require|actually)/i.test(q.q));
  officerCards.length >= 1 ? ok(`${officerCards.length} card(s) ask what the Creed says about officers: ${officerCards.map((q) => q.id).join(", ")}`) : bad("no card asks what the Creed says about officers");
  for (const c of officerCards) {
    /Officers of my unit will have maximum time to accomplish their duties; they will not have to accomplish mine\./.test(c.a)
      ? ok(`${c.id}: answers with the Creed's real officer passage`) : bad(`${c.id}: "${c.a.slice(0, 160)}"`);
  }
  /* Anything inside double quotes on those cards must be findable in the Creed (or be the Oath, which the card names). */
  for (const c of officerCards.concat(bank.filter((q) => q.id === "ncoc-3" && !officerCards.includes(q)))) {
    const quoted = (c.a.match(/"([^"]{25,})"/g) || []).map((s) => s.slice(1, -1));
    const stray = quoted.filter((s) => !s.split(/(?<=[.;]) /).every((part) => creedText.includes(part.replace(/^\.\.\.|\.\.\.$/g, "").trim()) || /officers appointed over me/.test(part) || /^I will carry out the orders/.test(part)));
    stray.length === 0 ? ok(`${c.id}: every quotation is word-for-word from the Creed (or the named Oath)`) : bad(`${c.id}: quotation not found in the Creed: ${stray[0].slice(0, 120)}`);
  }
  const twin = bank.find((q) => /What does the NCO Creed require regarding officers\?/.test(q.q)) || bank.find((q) => q.id === "creeds-5");
  const back = await openCardBack(twin);
  (back && /Officers of my unit will have maximum time/.test(back.all) && !/carry out their orders/i.test(back.all))
    ? ok(`${twin.id}: the flipped card in Board Drill shows the real officer passage`) : bad(`${twin.id}: Board Drill back face: ${back ? back.all.slice(0, 240) : "not reachable"}`);
}

/* ---- C40 / U31 / U28: a pack that corrects a fact must not leave the old fact in the bank ---- */
console.log("\nC40/U31/U28 - the bank teaches one answer, from the current edition");
{
  const allText = (q) => textOf(q) + " \n " + q.source;
  /* (1) Statement of Charges: AR 735-5 (30 Apr 2026) uses DA Form 7923; "DD Form 362" appears nowhere in it. */
  const soc = bank.filter((q) => /statement of charges/i.test(allText(q)));
  soc.length >= 3 ? ok(`${soc.length} cards mention a Statement of Charges: ${soc.map((q) => q.id).join(", ")}`) : bad("expected the FLIPL card and the statement-of-charges cards, found " + soc.length);
  const teaches362 = bank.filter((q) => /DD Form 362/.test(allText(q)) && !/DD Form 362[^.]*(out of date|does not mention)|does not mention DD Form 362/.test(allText(q)));
  teaches362.length === 0 ? ok("no card teaches DD Form 362 as the Army's statement of charges") : bad("still teaching DD Form 362: " + teaches362.map((q) => q.id).join(", "));
  soc.every((q) => /DA Form 7923/.test(allText(q))) ? ok("every Statement of Charges card names DA Form 7923") : bad("cards without DA Form 7923: " + soc.filter((q) => !/DA Form 7923/.test(allText(q))).map((q) => q.id).join(", "));
  const flipl = bank.find((q) => q.id === "prop-8");
  (flipl && !/chapter 13|13-3a|13-41|para 13-/.test(allText(flipl)) && /7-3c/.test(flipl.boardAnswer) && /30 Apr(il)? 2026/.test(flipl.boardAnswer))
    ? ok("prop-8 (FLIPL) cites the 30 Apr 2026 AR 735-5 (paras 7-2, 7-3c, 4-10), not the 2016 edition's chapter 13") : bad("prop-8 still cites superseded paragraphs: " + (flipl ? flipl.boardAnswer.slice(0, 160) : "missing"));
  const back = await openCardBack(flipl);
  (back && /DA Form 7923/.test(back.all) && !/DD Form 362/.test(back.all)) ? ok("prop-8's card back in Board Drill names DA Form 7923 and never DD Form 362") : bad("prop-8 card back: " + (back ? back.all.slice(0, 200) : "not reachable"));

  /* (2) SUDCC: AR 600-85 (4 Oct 2024) para 1-7c(3) - "While not a part of ASAP, SUDCC supports ..." */
  const sud = bank.filter((q) => /SUDCC/.test(allText(q)));
  const underAsap = sud.filter((q) => /under ASAP|under the Army Substance Abuse Program|side of the (broader )?Army Substance Abuse|side of the Army's substance abuse program|fit under/i.test(allText(q)));
  underAsap.length === 0 ? ok(`none of the ${sud.length} SUDCC cards files SUDCC under ASAP`) : bad("cards that still put SUDCC under ASAP: " + underAsap.map((q) => q.id).join(", "));
  const rel = sud.filter((q) => /relat|part of ASAP/i.test(q.q + " " + q.concept));
  (rel.length >= 1 && rel.every((q) => /not a part of ASAP/i.test(allText(q)))) ? ok(`every card about the SUDCC-ASAP relationship says "not a part of ASAP": ${rel.map((q) => q.id).join(", ")}`) : bad("relationship cards: " + JSON.stringify(rel.map((q) => [q.id, q.concept])));

  /* (3) CSDP: AR 710-4 (15 Apr 2026) chapter 3 establishes it; AR 710-2 (1 Jul 2024) para 2-3 only points there. */
  const csdpDoc = doctrine.find((d) => d.id === "doc-maint-3");
  (csdpDoc && /AR 710-4/.test(csdpDoc.source.ref) && !/AR 710-2/.test(csdpDoc.source.ref) && !/Program \(AR 710-2\)/.test(csdpDoc.body))
    ? ok("doctrine entry doc-maint-3 puts the CSDP under AR 710-4, matching the card") : bad("doc-maint-3 source: " + JSON.stringify(csdpDoc && csdpDoc.source));
  const csdpCards = bank.filter((q) => /Command Supply Discipline Program \(CSDP\)/.test(q.q));
  (csdpCards.length >= 1 && csdpCards.every((q) => /AR 710-4/.test(q.source) && !/USARJ|command policy/i.test(allText(q))))
    ? ok("the CSDP card cites AR 710-4 itself - not one command's local policy memo") : bad("CSDP card sources: " + JSON.stringify(csdpCards.map((q) => q.source)));
  /* The real consumer: searching doctrine for "CSDP" must not surface an AR 710-2 answer. */
  const found = await page.evaluate(() => G.store.doctrine("Command Supply Discipline").map((d) => ({ id: d.id, ref: d.source && d.source.ref })));
  (found.length >= 1 && found.every((d) => !/710-2/.test(d.ref || ""))) ? ok("a doctrine search for the CSDP returns only AR 710-4 entries") : bad("doctrine search: " + JSON.stringify(found));

  /* (4) No pack card restates a seed card: the twins are gone and their ids are not. */
  ["prog-acs-2", "prog-sudcc-1"].every((id) => !bank.find((q) => q.id === id)) ? ok("the two pack cards that restated acs-1 / sudcc-1 are gone") : bad("twin still in the bank");
  ["acs-1", "sudcc-1"].every((id) => bank.find((q) => q.id === id)) ? ok("...and the older ids they were folded into are still there (study history survives)") : bad("acs-1 / sudcc-1 missing");
  const missionCards = bank.filter((q) => /mission of Army Community Service/i.test(q.q));
  missionCards.length === 1 ? ok("exactly one card asks the ACS mission: " + missionCards[0].id) : bad(missionCards.length + " cards ask the ACS mission: " + missionCards.map((q) => q.id).join(", "));

  /* (5) Editions and paragraphs. Any card that prints an edition date for one of these five regulations must print the current one. */
  const CURRENT = { "AR 735-5": "30 Apr 2026", "AR 710-4": "15 Apr 2026", "AR 600-85": "4 Oct 2024", "AR 608-1": "26 May 2026", "AR 930-4": "15 Apr 2026" };
  const MONTHS = { January: "Jan", February: "Feb", March: "Mar", April: "Apr", May: "May", June: "Jun", July: "Jul", August: "Aug", September: "Sep", October: "Oct", November: "Nov", December: "Dec" };
  const stale = [];
  for (const q of bank) for (const reg of Object.keys(CURRENT)) {
    const re = new RegExp(reg.replace(/[-]/g, "[-–]") + "[^()]{0,60}\\((\\d{1,2}) ([A-Z][a-z]+) (\\d{4})\\)", "g");
    let m; while ((m = re.exec(allText(q)))) { const d = m[1] + " " + (MONTHS[m[2]] || m[2]) + " " + m[3]; if (d !== CURRENT[reg]) stale.push(q.id + ": " + reg + " (" + d + ")"); }
  }
  stale.length === 0 ? ok("every printed edition date for AR 735-5 / 710-4 / 600-85 / 608-1 / 930-4 is the current edition") : bad("stale edition dates: " + stale.join("; "));
  const aer = bank.filter((q) => /AER \(AR 930-4\)/.test(q.category));
  aer.every((q) => !/current regulation is dated 29 November 2024/.test(allText(q)) && !/1-18i/.test(allText(q)))
    ? ok("no AER card calls the 29 Nov 2024 edition current or cites para 1-18i (the informed-Soldiers duty is 1-18g)") : bad("AER cards with a stale edition/paragraph: " + aer.filter((q) => /29 November 2024 and|1-18i/.test(allText(q))).map((q) => q.id).join(", "));
  bank.every((q) => !/AR 608-1, para 1-6/.test(allText(q))) ? ok('no card cites "AR 608-1, para 1-6" (the mission paragraph of the superseded 2017 edition)') : bad("AR 608-1 para 1-6 still cited");
}

/* ---- zero console noise ---- */
console.log("");
noise.length === 0 ? ok("zero console errors/warnings across the run") : bad("console noise: " + noise.slice(0, 5).join(" | "));

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
