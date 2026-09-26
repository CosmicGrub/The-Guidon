/**
 * 1st Cavalry Division heritage content - and the song text that must NOT ship.
 *
 * The defect this guards (audit findings C25 / U32 / U19 / U20): the app
 * bundled the complete words of "Spirit of the Cav", a song with a named
 * author and no recorded public-domain or permission basis, as a recitable
 * record, eight line-by-line cards, a Creeds entry's full text and three
 * fill-in-the-blank strings. Every one of those cited "User-supplied ..." as
 * its source, and all 18 cards sat in the Army-wide "Creeds" recall deck that
 * every Soldier quizzes, whatever their unit.
 *
 * What this suite proves:
 *  - NO SONG TEXT SHIPS. The probes below are a few words each, read from the
 *    old module before it was deleted; they are looked for in both built
 *    files (web/index.html and dist/guidon-standalone.html), in every record
 *    of the running app's question bank and Creeds list, and in what the
 *    Creeds page and Recitation Drill put on screen. This file deliberately
 *    carries no more of the song than those probes, and must never be given
 *    more - "assert the text is present" is how the old suite locked the
 *    defect in.
 *  - The old recitable record and the sixteen line-by-line cards are gone,
 *    and nothing from this module is in the "Creeds" category any more.
 *  - What stays is fact: four heritage cards under "Army History", each
 *    citing a real U.S. Army page, plus a title-only Creeds entry. No record
 *    anywhere in the bank or the Creeds list cites "user-supplied" anything.
 *  - The Creeds page shows the entry with a real source line and points the
 *    Soldier at Recitation Drill's "My unit" section instead of the words.
 *  - The general rule, so the next unit song cannot arrive the same way: any
 *    bundled record carrying text to recite must record why GUIDON may
 *    reproduce it (see "the rights gate" below for the rights{} shape).
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { waitForRoute } from "./testkit.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// A few words each, from two different lines of the removed text. Compared
// case-insensitively with whitespace collapsed. Do not lengthen these.
const PROBES = ["sabers shining in", "fathers rode in"];
const hasProbe = (text) => {
  const t = String(text || "").toLowerCase().replace(/\s+/g, " ");
  return PROBES.filter((p) => t.includes(p));
};

// ---- 1. the built files themselves ------------------------------------
for (const rel of ["../web/index.html", "../dist/guidon-standalone.html"]) {
  const file = fileURLToPath(new URL(rel, import.meta.url));
  let text = null;
  try { text = readFileSync(file, "utf8"); } catch (e) { bad(rel + " could not be read - run `npm run build` first (" + e.message + ")"); }
  if (text === null) continue;
  const hits = hasProbe(text);
  hits.length === 0
    ? ok(rel.replace("../", "") + " carries none of the song's words")
    : bad(rel.replace("../", "") + " still carries song text (matched " + hits.length + " of " + PROBES.length + " probes)");
}

// ---- 2. the running app ------------------------------------------------
const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);

const truth = await page.evaluate((probes) => {
  const flat = (o) => JSON.stringify(o).toLowerCase().replace(/\\n/g, " ").replace(/\s+/g, " ");
  const bank = window.G.store.boardQuestions();
  const creeds = window.G.store.creeds();
  const mine = bank.filter((q) => /^pb-spirit-cav-/.test(q.id) || q.id === "creed-spirit-of-the-cav");
  return {
    lyricRecords: bank.concat(creeds).filter((r) => probes.some((p) => flat(r).includes(p))).map((r) => r.id),
    userSupplied: bank.concat(creeds).filter((r) => /user[- ]supplied/i.test(JSON.stringify(r.source || ""))).map((r) => r.id),
    oldRecitable: bank.some((q) => q.id === "creed-spirit-of-the-cav"),
    inRecitable: window.G.store.recitable().some((q) => /spirit|cav/i.test(q.id + " " + (q.concept || ""))),
    oldLineCards: bank.filter((q) => /^pb-spirit-cav-0[1-8]-/.test(q.id)).map((q) => q.id),
    withLines: mine.filter((q) => Array.isArray(q.lines) && q.lines.length).map((q) => q.id),
    helperObject: typeof window.G.spiritOfTheCav,
    // source as a Soldier reads it: a board card's citation is a structured array (ROADMAP item F Wave 2)
    mine: mine.map((q) => ({ id: q.id, category: q.category, pillar: q.pillar, source: window.G.board.sourceText(q), unit: q.unit })),
    // Card answers are only ever TESTED in here, never sent back out: if the
    // song text regresses, a failure message must not print it into a public
    // CI log. (Same reason the Creeds entry reports a length, not its text.)
    facts: (function () {
      const t = mine.map((q) => q.a).join(" | ");
      return { firstTeam: /1st Cavalry Division/.test(t), date: /13 September 1921/.test(t), place: /Fort Bliss/.test(t), seventhCavalry: /7th Cavalry/.test(t), divisionSong: /division song/i.test(t) };
    })(),
    inCreedsDeck: bank.filter((q) => q.category === "Creeds" && (/^pb-spirit-cav-/.test(q.id) || /1st cavalry|first team|garryowen|spirit of the cav/i.test(q.q + " " + q.a))).map((q) => q.id),
    creed: (function () {
      const c = creeds.find((x) => x.id === "creed-spirit-of-the-cav");
      return c ? { fullTextLength: String(c.fullText || "").length, ref: c.source && c.source[0] && c.source[0].pub, asOf: c.source && c.source[0] && c.source[0].edition, status: c.source && c.source[0] && c.source[0].status,
        linkedBoardId: c.linkedBoardId, lineCount: Array.isArray(c.lines) ? c.lines.length : 0 } : null;
    })(),
  };
}, PROBES);

truth.lyricRecords.length === 0
  ? ok("no card in the question bank and no Creeds entry carries any of the song's words")
  : bad("song text is still in these records: " + truth.lyricRecords.join(", "));
!truth.oldRecitable && !truth.inRecitable
  ? ok("the full-text recitable record is gone from the bank and from Recitation Drill's list")
  : bad("a Spirit of the Cav recitable record still exists (bank: " + truth.oldRecitable + ", recitable(): " + truth.inRecitable + ")");
truth.oldLineCards.length === 0 && truth.withLines.length === 0
  ? ok("the line-by-line and fill-in-the-blank cards are gone, and no remaining card carries lines[]")
  : bad("line cards remain: " + JSON.stringify(truth.oldLineCards) + " / cards with lines[]: " + JSON.stringify(truth.withLines));
truth.helperObject === "undefined"
  ? ok("the unused fill-in-the-blank helper object is gone")
  : bad("G.spiritOfTheCav still exists (" + truth.helperObject + ")");

truth.userSupplied.length === 0
  ? ok("no card or Creeds entry cites a \"user-supplied\" source")
  : bad("\"user-supplied\" is still cited by: " + truth.userSupplied.join(", "));

const officialSource = (s) => /army\.mil/i.test(String(s || ""));
truth.mine.length === 4 && truth.mine.every((q) => q.category === "Army History" && q.pillar === "Drill & Board Etiquette" && officialSource(q.source) && q.unit === "1st Cavalry Division")
  ? ok("four heritage cards remain, under Army History, each tagged to the division and citing a U.S. Army page")
  : bad("heritage cards malformed: " + JSON.stringify(truth.mine));
truth.inCreedsDeck.length === 0
  ? ok("nothing about one division's heritage is left in the Army-wide Creeds deck")
  : bad("unit-specific cards are still filed under Creeds: " + truth.inCreedsDeck.join(", "));
Object.keys(truth.facts).every((k) => truth.facts[k])
  ? ok("the cards teach the facts: First Team, the 1921 start at Fort Bliss, Garryowen and the 7th Cavalry, and what the song is")
  : bad("a heritage fact is missing from the card answers: " + JSON.stringify(truth.facts));

truth.creed && truth.creed.fullTextLength === 0 && truth.creed.lineCount === 0 && officialSource(truth.creed.ref) && /^\d{4}-\d{2}-\d{2}$/.test(truth.creed.asOf || "") &&
  truth.creed.status === "unit-tradition" && !truth.creed.linkedBoardId
  ? ok("the Creeds entry is title-and-history only, with a real source and the date it was checked")
  : bad("Creeds entry malformed: " + JSON.stringify(truth.creed));

// ---- 2b. the rights gate: no bundled text without a recorded basis -------
// The general rule behind this suite (audit recommendation R33). It reads the
// ASSEMBLED content - the seed plus everything the src/app-modules content
// files push in at load - because that is where the song came in: the seed
// lints never see module-delivered records.
//
// Any bundled record that carries text to recite (a non-empty lines[] or
// fullText) must say why GUIDON may reproduce it:
//   rights: { author, firstPublished, basis, evidence, checkedOn }
//     basis      "us-gov-work" | "pd-age" | "permission"   ("unknown" fails)
//     evidence   a citation or address a reviewer can open
//     checkedOn  YYYY-MM-DD, the day somebody actually checked
// The ten records below shipped before this rule, all citing an official Army
// issuing body; they are listed by id so the list cannot quietly grow. A NEW
// text needs a rights record - it does not get added here. (A Soldier's own
// "My unit" text is not bundled, so it is outside this gate by construction:
// tools/test-recite-user-text.mjs proves it never enters this content.)
const SHIPPED_BEFORE_THE_RULE = ["creed-4", "creed-5", "creed-7", "creed-soldiers", "creed-nco", "creed-ranger", "creed-army-values",
  "creed-night-stalker", "creed-combat-medic", "creed-cadet"];
const rightsGate = await page.evaluate((grandfathered) => {
  const BASES = ["us-gov-work", "pd-age", "permission"];
  const str = (v) => typeof v === "string" && v.trim().length > 0;
  const validRights = (r) => !!r && typeof r === "object" && str(r.author) && str(r.firstPublished) && BASES.indexOf(r.basis) !== -1 &&
    str(r.evidence) && /^\d{4}-\d{2}-\d{2}$/.test(r.checkedOn || "");
  const carriesText = (rec) => (Array.isArray(rec.lines) && rec.lines.length > 0) || str(rec.fullText);
  const needsRights = (rec) => carriesText(rec) && !validRights(rec.rights) && grandfathered.indexOf(rec.id) === -1;
  const seed = window.GUIDON_SEED;
  const all = (seed.board.questions || []).map((r) => ({ where: "board", r })).concat((seed.creeds || []).map((r) => ({ where: "creeds", r })));
  return {
    textRecords: all.filter((x) => carriesText(x.r)).length,
    offenders: all.filter((x) => needsRights(x.r)).map((x) => x.where + ":" + x.r.id),
    // The rule itself, tried on made-up records, so a typo that makes it
    // accept everything cannot hide behind today's clean content.
    selfCheck: {
      noRights: needsRights({ id: "zz-1", lines: ["a line"] }),
      unknownBasis: needsRights({ id: "zz-2", fullText: "text", rights: { author: "A", firstPublished: "1950", basis: "unknown", evidence: "x", checkedOn: "2026-09-19" } }),
      noDate: needsRights({ id: "zz-3", fullText: "text", rights: { author: "A", firstPublished: "1950", basis: "permission", evidence: "letter on file" } }),
      complete: needsRights({ id: "zz-4", fullText: "text", rights: { author: "U.S. Army", firstPublished: "2003", basis: "us-gov-work", evidence: "TC 7-22.7", checkedOn: "2026-09-19" } }),
      titleOnly: needsRights({ id: "zz-5", fullText: "", lines: [] }),
    },
  };
}, SHIPPED_BEFORE_THE_RULE);
rightsGate.textRecords > 0 && rightsGate.offenders.length === 0
  ? ok("every bundled text to recite (" + rightsGate.textRecords + " records, seed and content files together) either predates the rule by id or records why GUIDON may reproduce it")
  : bad("bundled text with no recorded rights basis: " + JSON.stringify(rightsGate.offenders) + " (" + rightsGate.textRecords + " text records seen)");
const sc = rightsGate.selfCheck;
sc.noRights === true && sc.unknownBasis === true && sc.noDate === true && sc.complete === false && sc.titleOnly === false
  ? ok("the rule rejects text with no rights record, an \"unknown\" basis or no check date, and accepts a complete record or a title-only entry")
  : bad("the rights rule itself is wrong: " + JSON.stringify(sc));

// ---- 3. what the Soldier actually sees --------------------------------
await page.evaluate(() => { location.hash = "#/creeds"; });
await page.waitForSelector(".list-detail-list .list-detail-row");
await page.locator(".list-detail-list .list-detail-row", { hasText: /Spirit of the Cav/i }).click();
await page.waitForFunction(() => /Spirit of the Cav/i.test((document.querySelector("#creeds-detail h3") || {}).textContent || ""));
const creedsDetail = await page.evaluate(() => document.getElementById("creeds-detail").innerText);
hasProbe(creedsDetail).length === 0 && /Source: .*army\.mil/i.test(creedsDetail) && !/user[- ]supplied/i.test(creedsDetail)
  ? ok("#/creeds shows the entry with a real source line and none of the words")
  : bad("#/creeds detail is wrong: song words on screen=" + hasProbe(creedsDetail).length + ", army.mil source line=" + /Source: .*army\.mil/i.test(creedsDetail) +
    ", says user-supplied=" + /user[- ]supplied/i.test(creedsDetail));
/My unit/.test(creedsDetail) && /stays on your device/i.test(creedsDetail)
  ? ok("#/creeds tells the Soldier where to add their own copy, and that it stays on their device")
  : bad("#/creeds does not point at Recitation Drill's My unit section");
const creedLinks = await page.evaluate(() => Array.from(document.querySelectorAll("#creeds-detail button")).map((b) => b.textContent));
!creedLinks.some((t) => /Board Drill|Practice reciting/i.test(t))
  ? ok("#/creeds offers no \"Practice reciting this\" link for a text the app does not carry")
  : bad("#/creeds still links the entry to a recitable record: " + JSON.stringify(creedLinks));

// #/creeds and #/recite share the same ".list-detail-list .list-detail-row"
// markup, so a bare waitForSelector can resolve against #/creeds' own rows,
// still on screen for a moment after the hash changes, before #/recite
// replaces them - and #/creeds really does list an entry matching /cav/i.
// waitForRoute (tools/testkit.mjs) tags the outgoing screen first and waits
// for a real swap.
await waitForRoute(page, "#/recite", { ready: ".list-detail-list .list-detail-row" });
const reciteRows = await page.evaluate(() => Array.from(document.querySelectorAll(".list-detail-list .list-detail-row")).map((r) => r.textContent));
const reciteText = await page.evaluate(() => document.getElementById("route").innerText);
!reciteRows.some((t) => /spirit|cav/i.test(t)) && hasProbe(reciteText).length === 0
  ? ok("#/recite no longer lists the song among the built-in texts")
  : bad("#/recite still lists it: " + JSON.stringify(reciteRows));

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
overflow <= 0 ? ok("no sideways scrolling at phone width (390px)") : bad("page is " + overflow + "px wider than the 390px screen");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors or warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSPIRIT OF THE CAV: all passed");
process.exit(fails ? 1 : 0);
