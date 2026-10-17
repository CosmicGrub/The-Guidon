#!/usr/bin/env node
/**
 * Superseded-publication gate: tools/lint-pub-supersession.mjs, proved against
 * stand-in banks, stand-in copies of the two files it reads, and the real bank.
 *
 * WHY THIS SUITE EXISTS. Audit 2026-10, item 10: 26 board cards, 3 doctrine
 * entries, a scenario and a whole First Aid course taught TC 4-02.1 as current
 * doctrine after the bundled ATP 4-02.11 had replaced it (its cover says
 * "supersedes TC 4-02.1, dated 21 January 2016"), and no gate could see it. The
 * gate reads the supersession table that MOI Import already owns
 * (MOI_CITATION_ALIASES in src/app-modules/moi-import.js - there is no second
 * list) and enforces only the rows the bundled Library itself proves. Deleting
 * this file would let the following ship unnoticed:
 *   - a card, doctrine entry, scenario reference or course lesson that names a
 *     replaced publication as a current source again (the structured `pub` and the
 *     prose cite at the end of an answer alike);
 *   - the gate quietly turning itself off - a renamed table constant, a row
 *     removed, or a Library whose cover page no longer proves the replacement;
 *   - the opposite mistake, a gate that fires on things that are fine: a sentence
 *     that SAYS the publication was superseded, a different manual whose number
 *     merely starts the same (ATP 4-02.1 is Army Medical Logistics, not TC 4-02.1),
 *     a row nobody has proved (FM 6-22 - the bundled ADP 6-22 still cites it as
 *     the current leader-development manual) or a table row for a publication the
 *     Library does not hold;
 *   - the relabel itself coming undone: the 19 First Aid cards back under a
 *     category named after the old manual, a card that reads as a word-for-word
 *     quotation of a manual it only paraphrases, a leaked reviewer note on a card,
 *     or MOI Import no longer sending an old TC 4-02.1 citation to ATP 4-02.11.
 *
 * Every check below can fail: the planted banks fail the lint, the honest
 * controls beside each one pass, and the real-bank checks read the live data.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleBank } from "./assemble-bank.mjs";
import { readSeed, writeSeed } from "./seed-io.mjs";
import { quoteKindOf } from "./citation-parse.mjs";
import {
  readAliasTable, readLibraryDocs, coverEvidence, designatorRegex, unmarkedMentions, loadSupersessions,
  MOI_PATH, LIBRARY_PATH,
} from "./lint-pub-supersession.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const LINT = path.join(HERE, "lint-pub-supersession.mjs");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(typeof fail === "function" ? fail() : (fail === undefined ? pass : fail)));
const J = (v) => JSON.stringify(v);

console.log("lint-pub-supersession: the gate reads MOI_CITATION_ALIASES, enforces only what the bundled Library proves, and the First Aid relabel holds\n");

/* =====================================================================
   1. The table and the proof, read from the REAL files
   ===================================================================== */
console.log("1. the table and the proof");
const moiSrc = readFileSync(MOI_PATH, "utf8");
const libSrc = readFileSync(LIBRARY_PATH, "utf8");
const table = readAliasTable(moiSrc);
const docs = readLibraryDocs(libSrc);
check(table["TC 4-02.1"] === "ATP 4-02.11", "MOI_CITATION_ALIASES (read from moi-import.js) holds TC 4-02.1 -> ATP 4-02.11", () => "table: " + J(table));
check(table["FM 3-22.9"] === "TC 3-22.9" && Object.keys(table).length >= 5, "...beside the rows it already had (FM 3-22.9 -> TC 3-22.9 ...), none lost", () => "table: " + J(table));
const sup = loadSupersessions();
const enforcedKeys = sup.enforced.map((r) => r.oldKey).sort();
check(J(enforcedKeys) === J(["FM 3-22.9", "TC 4-02.1"]), "exactly the two rows the Library proves are enforced: TC 4-02.1 and FM 3-22.9", () => "enforced: " + J(enforcedKeys));
const tcEv = coverEvidence(docs, "TC 4-02.1", "ATP 4-02.11");
check(tcEv.proven && /21 January 2016/.test(tcEv.quote), "the proof for TC 4-02.1 is ATP 4-02.11's own cover page ('supersedes TC 4-02.1, dated 21 January 2016')", () => "evidence: " + J(tcEv.quote || tcEv.why));
const rifleEv = coverEvidence(docs, "FM 3-22.9", "TC 3-22.9");
check(rifleEv.proven && /12 August 2008/.test(rifleEv.quote), "...and for FM 3-22.9, TC 3-22.9's cover ('supersedes FM 3-22.9, 12 August 2008')", () => "evidence: " + J(rifleEv.quote || rifleEv.why));
const unproven = sup.notEnforced.map((r) => r.oldKey).sort();
check(J(unproven) === J(["AR 600-8-1", "FM 3-23.35", "FM 6-22"]), "FM 6-22, FM 3-23.35 and AR 600-8-1 are NOT enforced - the Library cannot prove them (and for FM 6-22 it points the other way)", () => "not enforced: " + J(unproven));
check((() => { try { readAliasTable("const nothing = 1;"); return false; } catch (e) { return /could not find/.test(e.message); } })(), "a moi-import.js with no such table makes the reader throw (the gate fails loudly rather than switching itself off)");

/* =====================================================================
   2. A designator is whole, and a marked sentence is not a teaching
   ===================================================================== */
console.log("\n2. matching rules");
const hits = (text, d = "TC 4-02.1") => unmarkedMentions(text, d).length;
check(hits("Per TC 4-02.1, para 3-9: stop the bleeding.") === 1, "'Per TC 4-02.1, para 3-9: ...' is a teaching (1 unmarked mention)");
check(hits("(TC 4-02.1.)") === 1 && hits("TC 4-02.1") === 1 && hits("tc 4‑02.1") === 1, "...at a sentence end, alone, in lower case and with a non-breaking hyphen too");
check(hits("ATP 4-02.1 (Oct 2015), Army Medical Logistics") === 0, "honest: ATP 4-02.1 (Army Medical Logistics) is a different manual and is not TC 4-02.1");
check(hits("TC 4-02.11 and TC 4-02.1-2 and TC 4-02.1.5") === 0, "honest: a longer number (TC 4-02.11, 4-02.1-2, 4-02.1.5) is not TC 4-02.1");
check(hits("ATP 4-02.11, which superseded TC 4-02.1 in March 2026.") === 0, "honest: 'which superseded TC 4-02.1 in March 2026' marks the change");
check(hits("The older, superseded FM 3-22.9 said trigger squeeze.", "FM 3-22.9") === 0 && hits("TC 4-02.1 was replaced by ATP 4-02.11.") === 0 && hits("Formerly TC 4-02.1.") === 0 && hits("TC 4-02.1 (rescinded)") === 0, "honest: formerly / replaced / rescinded / older in the same sentence all mark the change");
check(hits("It was superseded. Per TC 4-02.1, apply it.") === 1, "...but a marker in the NEXT sentence does not excuse a teaching sentence");
check(hits("Source: TCCC / TC 4-02.1\nsuperseded notes live here") === 1, "...nor does a marker on the next line");
check(hits("CTC 4-02.1 and xTC 4-02.1") === 0 && hits("see TC 4-02.1") === 1, "honest: the pub type is a whole word (CTC 4-02.1 is not TC 4-02.1), while a plain 'see TC 4-02.1' still counts");
check(designatorRegex("TC 4-02.1").test("see TC 4-02.1") && !designatorRegex("TC 4-02.1").test("ATP 4-02.1"), "designatorRegex('TC 4-02.1') matches the designator and not ATP 4-02.1");

/* =====================================================================
   3. The real bank passes, and the relabel holds
   ===================================================================== */
console.log("\n3. the real bank");
const run = (extra = []) => { const r = spawnSync(process.execPath, [LINT, ...extra], { encoding: "utf8", cwd: APP }); return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const real = run();
check(real.status === 0 && /LINT-PUB-SUPERSESSION: all passed/.test(real.out), "the lint passes on the real bank", () => "exit " + real.status + "\n" + real.out);
check(/NOTE  FM 6-22 -> ADP 6-22 is NOT enforced/.test(real.out) && /NOTE  FM 3-23\.35/.test(real.out) && /NOTE  AR 600-8-1/.test(real.out), "...and says which table rows it is not enforcing, and why", () => real.out);

const bank = assembleBank().data;
const board = bank.board.questions, byId = new Map(board.map((q) => [q.id, q]));
const firstAid = board.filter((q) => /^tc4021-\d+$/.test(q.id));
check(firstAid.length === 19 && firstAid.every((q) => q.category === "ATP 4-02.11"), "the 19 tc4021-* cards keep their ids (saved study progress is keyed by id) and sit in the category 'ATP 4-02.11'", () => J(firstAid.map((q) => [q.id, q.category])));
check(!board.some((q) => q.category === "TC 4-02.1"), "no board card is left in a category named after the replaced manual");
check(firstAid.every((q) => q.source.length === 1 && q.source[0].pub === "ATP 4-02.11" && q.source[0].quoteKind === "verbatim"), "each of the 19 cites ATP 4-02.11 and still reads as a quotation (they ARE quoted from it - paragraphs and wording re-read against the bundled text)", () => J(firstAid.filter((q) => q.source[0].pub !== "ATP 4-02.11").map((q) => q.id)));
const stillOld = [];
for (const q of firstAid) for (const f of ["q", "a", "boardAnswer", "concept"]) if (/\bTC 4-02\.1\b/.test(q[f] || "")) stillOld.push(q.id + "." + f);
check(stillOld.length === 0 && firstAid.every((q) => /ATP 4-02\.11/.test(q.concept) || /ATP 4-02\.11/.test(q.boardAnswer)), "...and their wording says ATP 4-02.11 too, not just the structured field", () => J(stillOld));
const legacy = ["bq-tccc-02", "bq-tccc-03", "tccc-004", "tccc-005", "tccc-006", "tccc-10"].map((id) => byId.get(id));
check(legacy.every((q) => q && quoteKindOf(q.source) === "paraphrase" && q.source.some((e) => e.pub === "ATP 4-02.11" || /ATP 4-02\.11/.test(e.pub))), "the six older First Aid cards cite ATP 4-02.11 and read 'Study-guide answer', not as a word-for-word quotation of it", () => J(legacy.map((q) => q && [q.id, quoteKindOf(q.source)])));
check(!/FLAG FOR REVIEWER/.test(JSON.stringify(bank)), "no 'FLAG FOR REVIEWER' note is left anywhere in the bank (tc4021-8 carried one as its first key point, where a Soldier reads it)");
const ace = byId.get("tc4021-8");
check(ace && /Acknowledge, Care, and Escort/.test(ace.keyPoints[0]) && /para 20-38/.test(ace.keyPoints[0]), "tc4021-8's first key point now states the mnemonic, with its paragraph", () => J(ace && ace.keyPoints[0]));
const sixtyEight = byId.get("68w-scope-02");
check(sixtyEight && sixtyEight.source.map((e) => e.pub).join("|") === "ATP 4-02.11|ATP 4-02.84 (Combat Lifesaver Program)", "68w-scope-02 (68W pack) no longer lists TC 4-02.1, and keeps ATP 4-02.84 (an SME call, not this change)", () => J(sixtyEight && sixtyEight.source));
const docById = new Map(bank.doctrine.entries.map((d) => [d.id, d]));
check(["doc-armymed-3", "doc-medfa-3", "doc-medfa-4"].every((id) => { const e = docById.get(id).source.find((s) => s.pub === "ATP 4-02.11"); return e && e.edition === "2026-03" && !docById.get(id).source.some((s) => s.pub === "TC 4-02.1"); }), "doc-armymed-3, doc-medfa-3 and doc-medfa-4 cite ATP 4-02.11 (edition 2026-03), not 'TC 4-02.1, 2020'", () => J(["doc-armymed-3", "doc-medfa-3", "doc-medfa-4"].map((id) => docById.get(id).source)));
check(docById.get("doc-armymed-3").source.some((s) => s.pub === "ATP 4-02.84"), "...doc-armymed-3 keeps its second source, ATP 4-02.84 (untouched - needs an SME check)");
check(/which superseded TC 4-02\.1 in March 2026/.test(docById.get("doc-tccc").boardAnswer), "doc-tccc's own sentence 'which superseded TC 4-02.1 in March 2026' is still there (the change is marked, so the gate leaves it)");
const scen = bank.scenarios.scenarios.find((s) => s.id === "sc-68w-scope-of-practice");
check(scen && scen.doctrine.every((d) => d.pub !== "TC 4-02.1") && scen.doctrine.some((d) => d.pub === "ATP 4-02.11" && d.edition === "2026-03" && /paras 1-11, 3-14 to 3-18/.test(d.para)), "sc-68w-scope-of-practice cites ATP 4-02.11 (2026-03) for the Combat Lifesaver paragraphs it can name", () => J(scen && scen.doctrine));
const course = bank.curriculum.courses.find((c) => c.id === "c-firstaid");
const lessonsOld = course.lessons.filter((l) => (l.source || []).some((s) => s.pub === "TC 4-02.1") || /TC 4-02\.1\b/.test(JSON.stringify(l)));
check(course.source.every((s) => s.pub === "ATP 4-02.11") && course.lessons.length > 0 && lessonsOld.length === 0 && course.lessons.every((l) => l.source.some((s) => s.pub === "ATP 4-02.11")), "the First Aid course (its own source and every lesson) cites ATP 4-02.11 - the audit had missed the curriculum", () => J(lessonsOld.map((l) => l.id)));
const wf = bank.curriculum.courses.find((c) => c.id === "c-warfight").lessons.find((l) => l.id === "l-firstaid");
check(wf.source.every((s) => s.pub === "ATP 4-02.11"), "...and so does the War-fighting course's First Aid lesson", () => J(wf.source));
const adp9 = byId.get("adp-9");
check(adp9 && adp9.source.some((e) => e.pub === "FM 6-22"), "honest path unchanged: adp-9 (the card ABOUT FM 6-22, the current leader-development manual) still cites FM 6-22 and the real lint still passes", () => J(adp9 && adp9.source));

/* =====================================================================
   4. The gate against planted banks
   ===================================================================== */
console.log("\n4. the gate - planted banks");
const scratch = mkdtempSync(path.join(tmpdir(), "guidon-pub-supersession-"));
try {
  const SEED = path.join(scratch, "index.html");
  copyFileSync(path.join(APP, "src", "index.html"), SEED);
  const base = readSeed(SEED).data;
  const src = (pub, kind = "verbatim") => [{ pub, edition: "", para: "", quoteKind: kind }];
  const card = (id, source, text = "Answer.") => ({ id, category: "Army Values", q: "Question " + id + "?", a: text, boardAnswer: text, keyPoints: [text], difficulty: "basic", source });
  const docEntry = (id, source) => ({ id, title: "T " + id, topic: "Medical / First Aid", tier: ["E4"], body: "Body.", boardAnswer: "Body.", confidence: "verified", keyPoints: ["Body."], source });
  const scenario = (id, doctrine) => ({ id, title: "S " + id, tier: ["E4"], competency: ["Leads"], difficulty: "Basic", doctrine, defaultMode: "course", renderModes: ["course"], start: "n1", nodes: { n1: { prompt: "p", end: true, outcome: "o" } } });
  const course2 = (id, lessonSource) => ({ id, title: "C " + id, source: src("ATP 4-02.11", "paraphrase"), tier: ["E4"], lessons: [{ id: id + "-l1", title: "L", source: lessonSource, tiers: { layman: "x", beginner: "x", intermediate: "x", professional: "x" } }] });
  const plant = ({ board = [], doctrine = [], scenarios = [], courses = [] }, extraArgs = []) => {
    copyFileSync(path.join(APP, "src", "index.html"), SEED);
    const d = readSeed(SEED).data;
    d.board.questions.push(...board); d.doctrine.entries.push(...doctrine); d.scenarios.scenarios.push(...scenarios); d.curriculum.courses.push(...courses);
    writeSeed(d, SEED);
    return run(["--seed", SEED, ...extraArgs]);
  };
  const failsOn = (name, r, ...needles) => check(r.status === 1 && needles.every((n) => (typeof n === "string" ? r.out.includes(n) : n.test(r.out))), `the lint FAILS on ${name}, naming it`, () => `exit ${r.status}\n${r.out.slice(-1800)}`);
  const passes = (name, r) => check(r.status === 0 && /all passed/.test(r.out), `honest control passes: ${name}`, () => `exit ${r.status}\n${r.out.slice(-1800)}`);

  passes("a planted bank with no offending record (the lint is not simply always failing)", plant({ board: [card("plant-ok", src("ATP 4-02.11"), "Per ATP 4-02.11, para 1-1: stop the bleeding.")] }));
  failsOn("a board card that teaches TC 4-02.1 as a verbatim source", plant({ board: [card("plant-tc", src("TC 4-02.1"), "Per TC 4-02.1, para 1-1: stop the bleeding.")] }), "board:plant-tc", "TC 4-02.1", "reads as a verbatim quotation", "ATP 4-02.11");
  failsOn("a card whose structured source is relabeled but whose prose cite is not", plant({ board: [card("plant-prose", src("ATP 4-02.11"), "Stop the bleeding. (TC 4-02.1, para 1-1.)")] }), "board:plant-prose", "(TC 4-02.1, para 1-1.)");
  passes("a card that SAYS the manual was superseded (the change is marked)", plant({ board: [card("plant-marked", src("ATP 4-02.11"), "Stop the bleeding. ATP 4-02.11 superseded TC 4-02.1 in March 2026.")] }));
  failsOn("a paraphrase card that still cites TC 4-02.1 (the gate does not wait for the word verbatim)", plant({ board: [card("plant-para", src("TC 4-02.1", "paraphrase"))] }), "board:plant-para");
  failsOn("a doctrine entry whose source is TC 4-02.1", plant({ doctrine: [docEntry("plant-doc", src("TC 4-02.1", "paraphrase"))] }), "doctrine:plant-doc");
  failsOn("a scenario whose doctrine reference is TC 4-02.1", plant({ scenarios: [scenario("plant-sc", [{ pub: "TC 4-02.1", edition: "2020", para: "x", quoteKind: "paraphrase" }])] }), "scenarios:plant-sc");
  failsOn("a course lesson whose source is TC 4-02.1 (a section the first audit missed)", plant({ courses: [course2("plant-course", src("TC 4-02.1", "paraphrase"))] }), "curriculum:plant-course-l1");
  failsOn("FM 3-22.9, the other proven row, taught as a source", plant({ board: [card("plant-fm", src("FM 3-22.9"))] }), "board:plant-fm", "FM 3-22.9", "TC 3-22.9");
  passes("a card that cites ATP 4-02.1 (Army Medical Logistics) - a different manual", plant({ board: [card("plant-medlog", src("ATP 4-02.1 (Oct 2015), Army Medical Logistics"), "Class VIII is managed per ATP 4-02.1.")] }));
  passes("a card that cites FM 6-22 (not proven superseded; the bundled ADP 6-22 still cites it as current)", plant({ board: [card("plant-fm622", src("FM 6-22"), "Developing Leaders, FM 6-22, covers leader development.")] }));
  passes("a card that cites a longer number (TC 4-02.11) that is nothing to do with TC 4-02.1", plant({ board: [card("plant-longer", src("TC 4-02.11"), "Per TC 4-02.11, para 1-1.")] }));

  /* ---- the table is the single source: edit the table, the gate follows ---- */
  const moiStandIn = path.join(scratch, "moi-import.js");
  const libStandIn = path.join(scratch, "library.js");
  const offender = { board: [card("plant-tc2", src("TC 4-02.1"), "Per TC 4-02.1, para 1-1.")] };

  writeFileSync(moiStandIn, moiSrc.replace(/\n\s*"TC 4-02\.1": "ATP 4-02\.11",[^\n]*/, ""), "utf8");
  check(!/"TC 4-02\.1": "ATP 4-02\.11"/.test(readFileSync(moiStandIn, "utf8")), "fixture sanity: the stand-in moi-import.js has the TC 4-02.1 row removed");
  passes("with the TC 4-02.1 row removed from the table, a TC 4-02.1 card is no longer gated (the table IS the switch)", plant(offender, ["--moi", moiStandIn]));

  writeFileSync(moiStandIn, moiSrc.replace(/(\n\s*"TC 4-02\.1": "ATP 4-02\.11",[^\n]*)/, '$1\n    "TC 9-99": "ATP 9-99",   // a row nobody has proved'), "utf8");
  const bogus = plant({ board: [card("plant-bogus", src("TC 9-99"), "Per TC 9-99.")] }, ["--moi", moiStandIn]);
  check(bogus.status === 0 && /NOTE  TC 9-99 -> ATP 9-99 is NOT enforced: ATP 9-99 is not in the bundled Library/.test(bogus.out), "a new table row for a publication the Library does not hold is reported as not enforced and fails nothing (no gate without proof)", () => bogus.out);

  writeFileSync(moiStandIn, moiSrc.replace("const MOI_CITATION_ALIASES = {", "const SOMETHING_ELSE = {"), "utf8");
  const renamed = run(["--moi", moiStandIn]);
  check(renamed.status === 1 && /could not set the gate up: could not find `const MOI_CITATION_ALIASES/.test(renamed.out), "a renamed table constant FAILS the lint loudly instead of silently enforcing nothing", () => renamed.out);

  /* ---- the proof is mechanical: take the sentence off ATP 4-02.11's cover and the row stops being enforced ---- */
  const libDocs = readLibraryDocs(libSrc);
  const atp = libDocs.find((d) => d.citation === "ATP 4-02.11");
  atp.pages = atp.pages.map((p) => p.replace(/This publication supersedes TC 4-02\.1, dated 21 January 2016\./g, "").replace(/supersedes TC 4-02\.1/g, "mentions an older manual"));
  writeFileSync(libStandIn, libSrc.replace(/const DOCS = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/, () => "const DOCS = JSON.parse(" + JSON.stringify(JSON.stringify(libDocs)) + ");"), "utf8");
  check(!coverEvidence(readLibraryDocs(readFileSync(libStandIn, "utf8")), "TC 4-02.1", "ATP 4-02.11").proven, "fixture sanity: with the sentence taken off its cover, the Library no longer proves TC 4-02.1 -> ATP 4-02.11");
  const noProof = plant(offender, ["--library", libStandIn]);
  check(noProof.status === 0 && /NOTE  TC 4-02\.1 -> ATP 4-02\.11 is NOT enforced: ATP 4-02\.11's cover/.test(noProof.out), "...and a TC 4-02.1 card then passes, with the NOTE naming why the row is not enforced (the evidence is read from the Library, not assumed)", () => noProof.out);
  const withProof = plant(offender);
  check(withProof.status === 1, "control: the same planted card against the real Library fails (the proof is what turned the gate on)", () => withProof.out);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPUB SUPERSESSION: all passed" : `\nPUB SUPERSESSION: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
