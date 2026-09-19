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
import { CATEGORY_PILLAR } from "./pillar-map.mjs";
import { loadManifest } from "./content-manifest.mjs";

// How big the 92A deck is comes from the committed content manifest, not a
// typed 40: adding a 92A card must not break this suite, and losing one is
// already refused by the manifest's own ratchet (tools/content-manifest.mjs).
const REVIEWED = loadManifest().board;
const MOS_92A_CARDS = REVIEWED.byMos["92A"] || 0;
const CATEGORIES_92A = Object.keys(REVIEWED.byCategory).filter((c) => /^92A/.test(c));
const CARDS_IN_92A_CATEGORIES = CATEGORIES_92A.reduce((n, c) => n + REVIEWED.byCategory[c], 0);

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
async function openCardBack(card, pillar) {
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(250);
  await page.evaluate(([cat, pil]) => { G.board._filterCat = cat; if (pil) G.board._filterPillar = pil; location.hash = "#/board"; }, [card.category, pillar || null]);
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
          label: ((b.querySelector(".bq-answer-label") || {}).textContent || "").trim(), // the icon leaves a leading space
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

  /* (3b) Hand-receipt and inventory rules moved from the 2008 AR 710-2 to AR 710-4 (15 Apr 2026): Table 16-1, Table 1-1, para 4-7. */
  const moved = ["prop-5", "prop-6", "prop-7"].map((id) => bank.find((q) => q.id === id));
  moved.every((q) => q && /AR 710-4 \(15 Apr 2026\)/.test(q.source) && !/AR 710-2/.test(q.boardAnswer)) ? ok("prop-5 / prop-6 / prop-7 cite AR 710-4 (15 Apr 2026), not the 2008 AR 710-2's Table 2-2 and glossary") : bad("still on the 2008 AR 710-2: " + moved.filter((q) => !q || !/AR 710-4/.test(q.source)).map((q) => q && q.id).join(", "));
  const std = bank.filter((q) => /management level/i.test(allText(q)) && /95\s*[–-]\s*100%/.test(allText(q).replace(/superseded edition allowed 95% to 100%/g, "")));
  std.length === 0 ? ok("the inventory accuracy standard is taught as 98% to 100% (AR 710-4 Table 1-1), nowhere as the old 95-100%") : bad("cards still teaching a 95-100% management level: " + std.map((q) => q.id).join(", "));
  /* A ratchet, not a finish line: the seed cards below still cite AR 710-2 for property-book rules and are NOT yet re-derived.
     The list may only shrink. (92A cards cite the CURRENT AR 710-2 for supply support activity rules - that is correct.) */
  const KNOWN_STALE_7102 = ["bq-prop-02", "bq-prop-03", "bq-prop-04", "prop-10", "phys-sec-004", "pat-6"];
  const cites7102 = bank.filter((q) => /AR 710-2\b(?! \(1 Jul 2024\))/.test(q.source) && !/^92A/.test(q.category)).map((q) => q.id);
  const fresh = cites7102.filter((id) => !KNOWN_STALE_7102.includes(id));
  fresh.length === 0 ? ok(`no new card cites the old AR 710-2 for property accountability (${cites7102.length} known ones still to re-derive: ${cites7102.join(", ")})`) : bad("cards citing AR 710-2 that are not on the known list: " + fresh.join(", "));

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

/* ---- C17: "verbatim doctrine" is only ever printed over a real quotation; every 92A card cites a real publication ---- */
console.log("\nC17 - honest card-back headings and real citations");
{
  const VERBATIM = "By the Book (verbatim doctrine)";
  const PARAPHRASE = await page.evaluate(() => G.board.PARAPHRASE_LABEL);
  (typeof PARAPHRASE === "string" && /not a word-for-word quote/.test(PARAPHRASE)) ? ok(`study-guide cards get their own heading: "${PARAPHRASE}"`) : bad("G.board.PARAPHRASE_LABEL = " + PARAPHRASE);
  const packCards = bank.filter((q) => /^pb-(core72|deck40)/.test(q.id) || /^(prog-(aer|acs|sudcc)-|supply-(csdp|statement))/.test(q.id));
  packCards.length > 150 ? ok(`${packCards.length} cards come from the supplement and gap packs`) : bad("only " + packCards.length + " pack cards found");
  const unflagged = packCards.filter((q) => q.verbatim !== false);
  unflagged.length === 0 ? ok("every one of them declares that its text is study-guide wording (verbatim:false)") : bad(unflagged.length + " pack cards still claim verbatim text, e.g. " + unflagged.slice(0, 4).map((q) => q.id).join(", "));

  /* (a) a supplement card whose one sentence used to be printed three times under two headings */
  const salute = bank.find((q) => q.q === "What is the salute?");
  const b1 = salute && await openCardBack(salute);
  if (!b1) bad("could not open the supplement card \"What is the salute?\"");
  else {
    const labels = b1.blocks.map((x) => x.label);
    !labels.includes(VERBATIM) ? ok(`${salute.id}: the card back no longer prints "${VERBATIM}" over a paraphrase`) : bad(`${salute.id}: headings are ${JSON.stringify(labels)}`);
    labels.includes(PARAPHRASE) ? ok("...it prints the study-guide heading instead") : bad("...headings are " + JSON.stringify(labels));
    const times = b1.all.split(salute.a).length - 1;
    times === 1 ? ok("...and the answer sentence appears once, not three times") : bad("...the answer sentence appears " + times + " times on the card back");
    b1.blocks.some((x) => /^Source: AR 600-25/.test(x.src)) ? ok("...with its Source line kept") : bad("...source line: " + JSON.stringify(b1.blocks.map((x) => x.src)));
  }
  /* (b) a gap-pack card: a short acceptable answer plus a longer spoken answer - two boxes, neither claims to be a quotation */
  const aer = bank.find((q) => q.id === "prog-aer-2");
  const b2 = aer && await openCardBack(aer);
  (b2 && b2.blocks.length === 2 && !b2.blocks.some((x) => x.label === VERBATIM) && b2.blocks.some((x) => x.label === PARAPHRASE))
    ? ok("prog-aer-2: both answers shown, the long one under the study-guide heading") : bad("prog-aer-2 blocks: " + JSON.stringify(b2 && b2.blocks.map((x) => x.label)));
  (b2 && b2.kp.length === 3) ? ok("...and its three real key points are still listed") : bad("prog-aer-2 key points: " + JSON.stringify(b2 && b2.kp));
  /* (c) a seed card that really quotes the publication keeps the verbatim heading */
  const rules = bank.find((q) => q.id === "wpn-9");
  const b3 = await openCardBack(rules);
  (b3 && b3.blocks.some((x) => x.label === VERBATIM && /Rule 4/.test(x.text))) ? ok("wpn-9 (quotes TC 3-22.9) still shows \"" + VERBATIM + "\"") : bad("wpn-9 blocks: " + JSON.stringify(b3 && b3.blocks.map((x) => x.label)));

  /* (c1) the Definitions tab shows the same cards - same honest heading there */
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForSelector(".qz-front .qz-prompt", { timeout: 15000 });
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.trim() === "Definitions"); if (b) b.click(); });
  await page.waitForSelector('input[aria-label="Search definitions"]', { timeout: 15000 });
  await page.fill('input[aria-label="Search definitions"]', "Leader responsibility to inform Soldiers about AER");
  await page.waitForTimeout(600);
  const defLabels = await page.evaluate(() => Array.from(document.querySelectorAll(".def-card")).filter((c) => /inform Soldiers about AER/.test(c.textContent)).map((c) => Array.from(c.querySelectorAll(".bq-answer-label")).map((l) => l.textContent.trim())));
  (defLabels.length === 1 && defLabels[0].includes(PARAPHRASE) && !defLabels[0].includes("By the Book")) ? ok("Definitions tab: prog-aer-2's long answer sits under the study-guide heading, not \"By the Book\"") : bad("Definitions tab labels: " + JSON.stringify(defLabels));

  /* (c2) the longer heading must not push the card sideways on a phone */
  await page.setViewportSize({ width: 390, height: 844 });
  const b4 = salute && await openCardBack(salute);
  const fit = await page.evaluate(() => {
    const sc = document.querySelector(".qz-back-scroll"), lab = document.querySelector(".qz-back .bq-bybook .bq-answer-label");
    return { page: document.documentElement.scrollWidth <= window.innerWidth + 1, scroll: sc ? sc.scrollWidth <= sc.clientWidth + 1 : false, label: lab ? lab.getBoundingClientRect().right <= window.innerWidth + 1 : false };
  });
  (b4 && fit.page && fit.scroll && fit.label) ? ok("at 390px the study-guide heading wraps inside the card - no sideways scroll") : bad("390px overflow: " + JSON.stringify(fit));
  await page.setViewportSize({ width: 1200, height: 900 });

  /* (d) citations: a publication designator, not "Army sustainment doctrine" */
  const PUB = /\b(AR|DA PAM|ATP|ADP|FM|TC|TM) \d/;
  const mos = bank.filter((q) => /^92A/.test(q.category));
  (mos.length > 0 && mos.length === CARDS_IN_92A_CATEGORIES) ? ok(`all ${mos.length} 92A prompts the content manifest records are in the bank`) : bad(mos.length + " 92A prompts found (the content manifest records " + CARDS_IN_92A_CATEGORIES + " - run this suite with no tier or MOS filter)");
  const uncited = mos.filter((q) => !PUB.test(q.source));
  uncited.length === 0 ? ok("every 92A card cites at least one Army publication by number") : bad(uncited.length + " 92A cards cite no publication: " + uncited.slice(0, 6).map((q) => q.id + " [" + q.source + "]").join("; "));
  const vague = packCards.filter((q) => /Army sustainment doctrine|Army supply procedures|Applicable Army program regulations|GCSS-Army procedures|CMF 92 career guidance|^GCSS-Army$/.test(q.source));
  vague.length === 0 ? ok("no pack card is sourced to a vague phrase (\"Army sustainment doctrine\", \"Army supply procedures\", ...)") : bad("vague sources: " + vague.slice(0, 6).map((q) => q.id + " [" + q.source + "]").join("; "));
  const scRefs = await page.evaluate(() => ["sc-92a-critical-part-overdue", "sc-92a-inventory-discrepancy"].map((id) => { const s = G.store.scenario(id); return s ? (s.doctrine || []).map((d) => d.ref) : null; }));
  scRefs.every((r) => r && r.length && r.every((x) => PUB.test(x))) ? ok("both 92A Train scenarios cite numbered publications too (" + scRefs.map((r) => r.join(" + ")).join("; ") + ")") : bad("92A scenario doctrine refs: " + JSON.stringify(scRefs));
  const classI = bank.find((q) => q.q === "What is Class I?");
  (classI && !/drinking water/.test(classI.a)) ? ok("Class I is subsistence; water is not folded into it (ATP 4-42 paras 1-22, 1-38)") : bad("Class I answer: " + (classI && classI.a));
  const log = doctrine.find((d) => d.id === "doc-log-1");
  (log && /ten classes of supply/i.test(log.body) && !/seven Classes of Supply/i.test(log.body + log.keyPoints.join(" "))) ? ok("doctrine entry doc-log-1 counts ten classes of supply, agreeing with the cards") : bad("doc-log-1: " + (log && log.body.slice(0, 160)));
}

/* ---- C48: the supplement's hand-copied pillar table must agree with tools/pillar-map.mjs ---- */
console.log("\nC48 - pack cards carry the pillar their category is mapped to");
{
  const wrong = bank.filter((q) => CATEGORY_PILLAR[q.category] && q.pillar !== CATEGORY_PILLAR[q.category]);
  wrong.length === 0 ? ok("every card whose category is in tools/pillar-map.mjs carries exactly that pillar (" + bank.filter((q) => CATEGORY_PILLAR[q.category]).length + " checked, seed and packs)") : bad(wrong.length + " cards disagree with pillar-map.mjs: " + wrong.slice(0, 6).map((q) => q.id + " [" + q.category + " -> " + q.pillar + "]").join("; "));
  /* Through the real filter: with the Leadership & Counseling pillar chip on, the supplement's Discipline card must be in the deck. */
  const disc = bank.find((q) => q.q === "What is an NCO's role in military discipline?");
  const back = disc && await openCardBack(disc, "Leadership & Counseling");
  back ? ok(disc.id + " is reachable in Board Drill with the Leadership & Counseling pillar filter on") : bad("the supplement's Discipline card is missing from the Leadership & Counseling pillar deck");
}

/* ---- One subject, one category: a pack must file its cards under the seed's exact category string ---- */
console.log("\nCategories - a pack never splits a seed subject under a second name");
{
  const RENAMED = {
    "Land Navigation": "Land Navigation (TC 3-25.26)", "Army Fitness Test": "Army Fitness Test (AFT)", "Weapons — M4/M16": "Weapons (TC 3-22.9)",
    "Army Body Composition": "AR 600-9 — Army Body Composition Program", "OPSEC": "OPSEC & Information Security", "Holistic Health & Fitness": "FM 7-22",
  };
  const cats = new Set(bank.map((q) => q.category));
  const left = Object.keys(RENAMED).filter((c) => cats.has(c));
  left.length === 0 ? ok("none of the six duplicate category names is left in the bank") : bad("duplicate category names still in the bank: " + left.join(", "));
  /* the same normalization lint-board-taxonomy rule (b) applies to the seed, here applied to the assembled bank */
  const normCat = (s) => String(s).toLowerCase().replace(/[—–]/g, "-").replace(/\s*\(.*?\)\s*/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const byNorm = {};
  cats.forEach((c) => { (byNorm[normCat(c)] = byNorm[normCat(c)] || []).push(c); });
  const near = Object.values(byNorm).filter((g) => g.length > 1);
  near.length === 0 ? ok(`no two of the ${cats.size} live categories are near-duplicates of each other`) : bad("near-duplicate categories: " + JSON.stringify(near));
  /* the pack cards really moved into the seed subject (they were not dropped) */
  const landNav = bank.filter((q) => q.category === "Land Navigation (TC 3-25.26)");
  (landNav.some((q) => /^pb-core72-/.test(q.id)) && landNav.some((q) => !/^pb-/.test(q.id))) ? ok(`"Land Navigation (TC 3-25.26)" now holds seed and supplement cards together (${landNav.length})`) : bad("Land Navigation (TC 3-25.26) does not mix seed and pack cards");
  /* and the real category picker offers each subject once */
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForSelector('select[aria-label="Filter by category"]', { timeout: 15000 });
  const options = await page.evaluate(() => Array.from(document.querySelector('select[aria-label="Filter by category"]').options).map((o) => o.value));
  const offered = Object.keys(RENAMED).filter((c) => options.includes(c));
  (offered.length === 0 && Object.values(RENAMED).every((c) => options.includes(c))) ? ok("Board Drill's category picker lists each of the six subjects once, under the seed's name") : bad("category picker still offers: " + offered.join(", "));
}

/* ---- U14: the same question is one card - and the Quiz never offers a twin's right answer as a wrong option ---- */
console.log("\nU14 - near-duplicate prompts are one card, on the older id");
{
  const totals = await page.evaluate(() => G.boardSupplement && G.boardSupplement.totals);
  (totals && totals.folded >= 28 && totals.unresolved === 0) ? ok(`${totals.folded} supplement prompts were folded into an older card; every fold target exists`) : bad("fold totals: " + JSON.stringify(totals));
  /* Same tokenizer the audit used: stop-worded, stemmed Jaccard similarity of the QUESTION text. */
  const STOP = new Set("what is the a an of to and or in for are does do you your should be by on with as that which who how why when it its this their they at from must can".split(" "));
  const stem = (w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
  const toks = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !STOP.has(w)).map(stem));
  const jac = (A, B) => { let i = 0; for (const x of A) if (B.has(x)) i++; const u = A.size + B.size - i; return u ? i / u : 0; };
  const T = bank.map((q) => ({ q, t: toks(q.q) }));
  const isSupp = (q) => /^pb-(core72|deck40)/.test(q.id);
  /* Pairs that look alike but ask different things - each one read and decided by hand. */
  const DIFFERENT = new Set(["pb-core72-40-1|bq-prog-04", "pb-core72-12-1|pb-core72-12-2", "pb-core72-13-1|pb-core72-13-2", "pb-core72-33-1|pb-core72-33-2", "pb-core72-58-2|fm722-2",
    "pb-deck40-92a-27-1|pb-deck40-92a-27-2", "pb-deck40-92a-36-2|nco-duties-1", "pb-core72-14-2|nco-sc-003", "pb-core72-14-2|ncosup-7", "pb-core72-14-2|bq-ncosc-02", "pb-core72-07-1|creed-1",
    "pb-core72-10-2|creeds-5", "pb-core72-16-2|bq24", "pb-deck40-general-17-2|bq-opsec-01"]);
  const twins = [];
  for (const x of T) { if (!isSupp(x.q)) continue; for (const y of T) { if (x === y || (isSupp(y.q) && y.q.id < x.q.id)) continue; if (jac(x.t, y.t) >= 0.6 && !DIFFERENT.has(x.q.id + "|" + y.q.id) && !DIFFERENT.has(y.q.id + "|" + x.q.id)) twins.push(x.q.id + " ~ " + y.q.id); } }
  twins.length === 0 ? ok("no supplement card's question is a near-duplicate (similarity >= 0.6) of another card's") : bad(twins.length + " near-duplicate question pairs remain: " + twins.slice(0, 8).join("; "));
  /* the older ids are the ones that survived */
  const kept = ["bq9", "wpn-9", "creeds-5", "bq-nav-02", "unif-1", "av-duty", "bq27", "adp60-1", "safety-003"];
  kept.every((id) => bank.find((q) => q.id === id)) ? ok("the older ids survive: " + kept.join(", ")) : bad("missing older ids: " + kept.filter((id) => !bank.find((q) => q.id === id)).join(", "));
  const terrain = bank.find((q) => q.id === "bq-nav-02");
  (terrain && terrain.sourceCards.includes("core72-71")) ? ok("...and carry the folded prompt's provenance (bq-nav-02 <- core72-71)") : bad("bq-nav-02 sourceCards: " + JSON.stringify(terrain && terrain.sourceCards));
  /* one answer for the principles of mission command: ADP 6-0 (7 Jul 2026) para 1-49 lists seven */
  const six = bank.filter((q) => /six principles/i.test(textOf(q)) && /mission command/i.test(textOf(q)) && !/older|pre-2019|superseded/i.test(textOf(q)));
  six.length === 0 ? ok("no card still teaches six principles of mission command (ADP 6-0 para 1-49 lists seven)") : bad("cards teaching six principles: " + six.map((q) => q.id).join(", "));
  !bank.some((q) => /Composite Risk Management process/.test(q.q)) ? ok("the risk management card no longer calls ATP 5-19 \"Composite Risk Management\"") : bad("a card still asks for the Composite Risk Management process");

  /* What the Quiz draws its wrong options from: every OTHER card's acceptable answer (renderQuiz's distractorPool).
     A folded prompt must leave exactly one card able to supply the right answer to it. Checked for the prompts whose
     twin answer was word-for-word equivalent, where the Quiz really did list the right answer twice. */
  const pool = await page.evaluate(() => G.store.boardQuestions().map((x) => ({ id: x.id, a: x.acceptableAnswer || x.a })));
  const RIGHT = [
    ["the five major terrain features", /hill, ridge, valley, saddle,? (and )?depression/i],
    ["the three minor terrain features", /^draw, spur, and cliff[.]?$/i],
    ["AR 600-8-19 as the whole answer", /^AR 600-8-19[.]?$/i],
    ["the five essential characteristics of the Army Profession", /^trust, honorable service, military expertise, stewardship, and esprit de corps.?$/i],
    ["the three categories of developmental counseling", /^event-oriented( counseling)?, performance( counseling)?, and professional growth counseling.?$/i],
  ];
  for (const [what, re] of RIGHT) {
    const holders = pool.filter((x) => re.test(x.a));
    holders.length <= 1 ? ok("at most one card can supply " + what + " (" + (holders[0] ? holders[0].id : "folded into a fuller answer") + ")") : bad(holders.length + " cards supply " + what + ": " + holders.map((x) => x.id).join(", "));
  }
}

/* ---- U13: MOS-only cards are for Soldiers in that MOS ---- */
console.log("\nU13 - 92A cards stay out of another MOS's pools");
{
  /* A guest profile lives only in memory, so a real personal profile + reload is the way to give the app an MOS
     (same pattern as test-ppw / test-career). Everything above ran as a guest with no MOS: all 40 cards were in the pool. */
  const asMos = async (mos) => {
    await page.evaluate(async (m) => { await G.db.put("kv", { k: "guidon:profile:v1", v: { onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT", mos: m } }); }, mos);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.G && G.store && G.profile && G.profile.cached && G.profile.cached() && G.store.boardQuestions().length > 900, null, { timeout: 30000 });
    await page.evaluate(() => { location.hash = "#/board"; });
    await page.waitForSelector('select[aria-label="Filter by category"]', { timeout: 15000 });
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const pool = G.store.boardQuestions();
      const pillarChip = Array.from(document.querySelectorAll("button, [role=button]")).find((b) => /Maintenance & Supply/.test(b.textContent) && /\d/.test(b.textContent));
      return {
        mosCards: pool.filter((q) => Array.isArray(q.mos) && q.mos.length).length,
        supplyPillar: pool.filter((q) => q.pillar === "Maintenance & Supply").length,
        options: Array.from(document.querySelector('select[aria-label="Filter by category"]').options).map((o) => o.value).filter((v) => /^92A/.test(v)).length,
        chip: pillarChip ? pillarChip.textContent.replace(/\s+/g, " ").trim() : null,
      };
    });
  };
  const infantry = await asMos("11B");
  infantry.mosCards === 0 ? ok("an 11B's question pool holds no 92A-only cards") : bad("11B pool still holds " + infantry.mosCards + " MOS-only cards");
  infantry.options === 0 ? ok("...Board Drill's category picker offers an 11B no \"92A — ...\" categories") : bad("11B still sees " + infantry.options + " 92A categories in the picker");
  const supply = await asMos("92a");
  (supply.mosCards > 0 && supply.mosCards === MOS_92A_CARDS) ? ok("a 92A (typed in lower case) gets all " + MOS_92A_CARDS) : bad("92A pool holds " + supply.mosCards + " MOS-only cards, the content manifest records " + MOS_92A_CARDS);
  (supply.options > 0 && supply.options === CATEGORIES_92A.length) ? ok("...and sees the 92A categories in the picker (" + supply.options + ")") : bad("92A sees " + supply.options + " 92A categories");
  (MOS_92A_CARDS > 0 && supply.supplyPillar - infantry.supplyPillar === MOS_92A_CARDS) ? ok(`the Maintenance & Supply pillar is ${infantry.supplyPillar} cards for the 11B and ${supply.supplyPillar} for the 92A - the ${MOS_92A_CARDS} MOS cards no longer count against another MOS's readiness`) : bad("M&S pillar: 11B " + infantry.supplyPillar + ", 92A " + supply.supplyPillar);
  const skill = await asMos("92A2O");
  skill.mosCards === MOS_92A_CARDS ? ok("an MOS typed with its skill level (92A2O) still matches") : bad("92A2O pool holds " + skill.mosCards);
}

/* ---- zero console noise ---- */
console.log("");
noise.length === 0 ? ok("zero console errors/warnings across the run") : bad("console noise: " + noise.slice(0, 5).join(" | "));

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
