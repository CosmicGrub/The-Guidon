/**
 * Structured citations, Wave 3 (ROADMAP.md item F): the citations in
 * curriculum, counsel, counsel bullets, forms, IDP, resilience, finance,
 * transition and writing are real `source: [{pub, edition, para, quoteKind}]`
 * arrays, and every screen that shows one shows exactly what it always did.
 *
 * WHY THIS SUITE EXISTS: Wave 3 rewrote ~690 free-text citation strings and
 * ~40 readers of them in one change. Two ways that ships broken and nobody
 * notices: a reader still expects the old string and prints "[object Object]"
 * (or nothing) on a screen the release checks never open; or a new content
 * pack quietly brings back the old shape (Wave 1 shipped that: four scenarios
 * printed "undefined (...)" in the AAR until this wave moved the lint onto the
 * assembled bank). Nothing here compares against a stored copy of old text -
 * every check reads the bank as it is TODAY, so it stays valid as content
 * changes.
 *
 *   1. The parser (tools/cite-schema.mjs): a table of the legacy shapes it must
 *      understand, each one required to re-render to the exact input; a
 *      deterministic fuzz of 3,000 strings held to the same round trip; text
 *      it cannot classify stays whole; it never says "verbatim". The renderer
 *      also bridges the two `para` conventions (Wave 1 stores a bare number,
 *      "3-3"; Waves 2 and 3 store the worded locator, "para 1-49"): a Wave 1
 *      array handed to it prints "ATP 7-22.02, para 3-3", never "..., 3-3",
 *      in Node and in the page - and no Wave 2/3 record has a bare number, so
 *      the bridge changes none of their text.
 *   2. The lint (tools/lint-citation-schema.mjs) fails, with a message that
 *      says what to write instead, when each of nine defects is planted in a
 *      copy of the seed - and passes on a clean copy.
 *   3. The migrator (tools/migrate-citations-wave3.mjs) turns legacy text back
 *      into arrays that render to the same text, changes nothing else in the
 *      file, and is idempotent.
 *   4. No reader in src/ still reads an old field (`lesson.citation`,
 *      `f.reference`, `sk.ref`, `t.cite` ...).
 *   5. The real app, driven through its real screens: G.util.citeText agrees
 *      with tools/cite-schema.mjs on EVERY record in the bank, and each
 *      screen (Learn incl. the print sheet, Forms incl. the print copy, Counsel,
 *      Develop, Health, Money, Write, Transition, Global Search, MOI Import's
 *      coverage) shows the citation the data says, character for character.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, ok, bad, check, finish, waitForRoute, until, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";
import { assembleBank } from "./assemble-bank.mjs";
import { readSeed, writeSeed } from "./seed-io.mjs";
import { WAVE3, VALID_QUOTE_KIND, parseLegacyCitation, renderCitation } from "./cite-schema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const SEED = path.join(APP, "src/index.html");
const NODE = process.execPath;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bank = assembleBank().data;
const cite = (o) => renderCitation(o && o.source);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ================================================================== *
 * 1. The parser
 * ================================================================== */
const E = (pub, extra = {}) => ({ pub, edition: "", para: "", quoteKind: "paraphrase", ...extra });
const TABLE = [
  ["ADP 6-22", [E("ADP 6-22")]],
  ["ADP 6-22 (2019)", [E("ADP 6-22", { edition: "2019" })]],
  ["AR 600-20, Ch 6 (15 Apr 2026)", [E("AR 600-20", { edition: "15 Apr 2026", para: "Ch 6" })]],
  ["AR 623-3, paras 2-5, 3-41, 3-42 (2025)", [E("AR 623-3", { edition: "2025", para: "paras 2-5, 3-41, 3-42" })]],
  ["ADP 5-0 (2019) / FM 5-0 (2022)", [E("ADP 5-0", { edition: "2019", sepAfter: " / " }), E("FM 5-0", { edition: "2022" })]],
  ["AR 600-8-19; DA Pam 600-25", [E("AR 600-8-19"), E("DA Pam 600-25")]],
  ["DA Form 4856 · ATP 6-22.1", [E("DA Form 4856", { sepAfter: " · " }), E("ATP 6-22.1")]],
  ["AR 600-20 para 4-6b; AR 27-10 3-3c", [E("AR 600-20", { para: "para 4-6b", paraSep: " " }), E("AR 27-10", { para: "3-3c", paraSep: " " })]],
  ["AR 600-20 Ch.7", [E("AR 600-20", { para: "Ch.7", paraSep: " " })]],
  ["ADP 6-22 — Presence", [E("ADP 6-22", { para: "Presence", paraSep: " — " })]],
  ["ATP 6-22.1 (Counseling), ADP 6-22 (Army Leadership and the Profession)", [E("ATP 6-22.1 (Counseling)", { sepAfter: ", " }), E("ADP 6-22 (Army Leadership and the Profession)")]],
  ["AR 600-8-22, Military Awards (30 Jul 2025)", [E("AR 600-8-22, Military Awards", { edition: "30 Jul 2025" })]],
  ["FM 6-27/MCTP 11-10C, The Commander's Handbook on the Law of Land Warfare (2019, Chg 2, 2025)", [E("FM 6-27/MCTP 11-10C, The Commander's Handbook on the Law of Land Warfare", { edition: "2019, Chg 2, 2025" })]],
  ["Soldier's Creed (2003)", [E("Soldier's Creed", { edition: "2003" })]],
  ["37 U.S.C. Ch. 3 & 5 / 10 U.S.C. Ch. 55", [E("37 U.S.C.", { para: "Ch. 3 & 5", paraSep: " ", sepAfter: " / " }), E("10 U.S.C.", { para: "Ch. 55", paraSep: " " })]],
  ["AR 600-9 (superseded by AD 2026-13 for the entry standard)", [E("AR 600-9 (superseded by AD 2026-13 for the entry standard)")]],
  // Not classifiable with confidence -> ONE entry holding the original wording.
  ["Unit custom; not documented in TC 3-21.5", [E("Unit custom; not documented in TC 3-21.5")]],
  ["ADP 6-22 / ACS", [E("ADP 6-22 / ACS")]],
  ["AR 623-3, glossary; para 2-7 (2025)", [E("AR 623-3, glossary; para 2-7 (2025)")]],
  ["38 CFR Part 21 / 38 USC 5101 / PACT Act (2022)", [E("38 CFR Part 21 / 38 USC 5101 / PACT Act (2022)")]],
  ["Army MRT curriculum", [E("Army MRT curriculum", { quoteKind: "synthesis" })]],
];
for (const [input, want] of TABLE) {
  const got = parseLegacyCitation(input).entries;
  check(same(got, want), `parse ${JSON.stringify(input)}`, () => "got " + JSON.stringify(got) + "\n        want " + JSON.stringify(want));
  check(renderCitation(got) === input, `  ... and it renders back to exactly that text`, () => "rendered " + JSON.stringify(renderCitation(got)));
}
check(parseLegacyCitation("").entries.length === 0 && parseLegacyCitation(undefined).entries.length === 0, "empty or missing text is no entries at all, not one empty entry");
check(renderCitation(undefined) === "" && renderCitation(null) === "" && renderCitation([]) === "" && renderCitation("as typed") === "as typed",
  "rendering a missing source is \"\" (never \"undefined\"); a plain string renders as itself");

// Wave 1 stores a BARE paragraph number ("3-3"); Waves 2 and 3 store the worded locator ("para 1-49", "Ch 6").
// A Wave 1 array handed to the renderer must never print "ATP 7-22.02, 3-3" (tools/cite-schema.mjs, "TWO CONVENTIONS FOR `para`").
const WAVE1_SHAPES = [
  [[{ pub: "ATP 7-22.02", edition: "", para: "3-3", quoteKind: "paraphrase" }], "ATP 7-22.02, para 3-3", "a Wave 1 bare paragraph number is worded"],
  [[{ pub: "AR 600-8-19", edition: "2026-03", para: "1-34a", quoteKind: "paraphrase" }], "AR 600-8-19, para 1-34a (2026-03)", "...with an edition after it, as the editions always follow the locator"],
  [[{ pub: "AR 600-20", edition: "2020", para: "4-6b (corrective training)", quoteKind: "paraphrase" }, { pub: "AR 27-10", edition: "", para: "3-3c", quoteKind: "paraphrase" }], "AR 600-20, para 4-6b (corrective training) (2020); AR 27-10, para 3-3c", "...and across two entries"],
  [[{ pub: "AR 600-20", edition: "", para: "Ch 6", quoteKind: "paraphrase" }], "AR 600-20, Ch 6", "a worded locator (Wave 2/3) is untouched"],
  [[{ pub: "AR 710-2", edition: "1 Jul 2024", para: "paras 4-3 and 6-5", editionFirst: true, quoteKind: "paraphrase" }], "AR 710-2 (1 Jul 2024), paras 4-3 and 6-5", "a worded locator with editionFirst is untouched"],
  [[{ pub: "AR 27-10", edition: "", para: "3-3c", paraSep: " ", quoteKind: "paraphrase" }], "AR 27-10 3-3c", "a bare number whose entry sets its own paraSep (a migrated record) is untouched"],
];
for (const [source, want, why] of WAVE1_SHAPES) {
  check(renderCitation(source) === want, `renderCitation: ${why} (${JSON.stringify(want)})`, () => "got " + JSON.stringify(renderCitation(source)));
}
{
  // On the real Wave 1 data (doctrine entries, PRT drills, scenario doctrine refs) no rendered entry is "pub, <bare number>".
  const w1 = [];
  (bank.doctrine.entries || []).forEach((e) => w1.push(["doctrine " + e.id, e.source]));
  (bank.prt.drills || []).forEach((d) => { w1.push(["prt " + d.id + " repRule", d.repRule && d.repRule.source]); (d.exercises || []).forEach((x) => w1.push(["prt " + x.id, x.source])); });
  (bank.scenarios.scenarios || []).forEach((s) => { if (Array.isArray(s.doctrine) && s.doctrine.some((x) => x && typeof x === "object")) w1.push(["scenario " + s.id, s.doctrine]); });
  const bareEntries = w1.flatMap(([label, src]) => (Array.isArray(src) ? src : []).filter((e) => e && /^\d/.test(e.para || "") && typeof e.paraSep !== "string").map((e) => [label, e]));
  const printsBare = bareEntries.filter(([, e]) => renderCitation([e]) !== e.pub + ", para " + e.para + (e.edition ? " (" + e.edition + ")" : ""));
  check(bareEntries.length > 20 && printsBare.length === 0, `the real Wave 1 collections carry ${bareEntries.length} bare-number paragraphs and every one renders as "pub, para N" (never "pub, N")`, () => JSON.stringify(printsBare.slice(0, 3)));
  // ...and NO Wave 2 or Wave 3 record has one, which is why bridging the two conventions changes none of their text.
  const w23 = [...bank.board.questions.map((q) => ["board " + q.id, q.source])];
  for (const site of WAVE3) for (const { owner, path: p } of site.owners(bank)) w23.push([site.id + " " + p.join("."), owner[site.field]]);
  const w23Bare = w23.flatMap(([label, src]) => (Array.isArray(src) ? src : []).filter((e) => e && /^\d/.test(e.para || "") && typeof e.paraSep !== "string").map(() => label));
  check(w23Bare.length === 0, `no Wave 2 or Wave 3 record (${w23.length} checked) has a bare-number para with the default joiner, so the renderer's bridge cannot change their text`, () => `${w23Bare.length}: ${JSON.stringify(w23Bare.slice(0, 3))}`);
}

// Deterministic fuzz: whatever the input, the parse re-renders to it exactly.
{
  let seed = 20260926;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pubs = ["AR 600-20", "ATP 6-22.1", "ADP 6-22", "FM 7-22", "DA PAM 600-25", "DA Pam 623-3", "TC 3-21.5", "DoDI 6400.06", "Army Directive 2026-13", "ALARACT 074/2020", "UCMJ", "UCMJ Art. 15", "JTR", "DoD FMR", "38 U.S.C.", "32 CFR", "DA 7906", "Soldier's Creed", "Unit SOP", "iPERMS", "AFT Standards", "Army Traditions", "MRT"];
  const locs = ["", ", Ch 6", ", para 4-6b", " para 4-6b", " Ch.7", " — Presence", ", paras 2-5, 3-41", ", App C", " 3-3c", ", glossary; para 2-7", " Section 2-4", " (Presence)", ", The Counseling Process", ", Activity 6.3"];
  const eds = ["", "", " (2019)", " (15 Apr 2026)", " (2019, Chg 2, 2025)", " (H2F)", " (current year)", " (1973/1986)"];
  const seps = ["; ", " / ", " · ", ", ", " ; ", "  /  ", ";", " & "];
  let bad0 = 0, wholes = 0, verbatim = 0, notObj = 0;
  for (let n = 0; n < 3000; n++) {
    const parts = 1 + Math.floor(rnd() * 4);
    let s = "";
    for (let i = 0; i < parts; i++) { if (i) s += pick(seps); s += pick(pubs) + pick(locs) + pick(eds); }
    const { entries, how } = parseLegacyCitation(s);
    if (renderCitation(entries) !== s) bad0++;
    if (how === "whole") wholes++;
    entries.forEach((e) => { if (e.quoteKind === "verbatim") verbatim++; if (typeof e.pub !== "string" || !e.pub || !VALID_QUOTE_KIND.includes(e.quoteKind)) notObj++; });
  }
  check(bad0 === 0, "fuzz: 3,000 generated citation strings each parse and re-render to exactly the original text", () => bad0 + " string(s) did not round-trip");
  check(verbatim === 0 && notObj === 0, "fuzz: no entry is ever marked verbatim (nothing here can verify a quotation), and every entry has a pub and a valid quoteKind", () => `verbatim=${verbatim} malformed=${notObj}`);
  check(wholes > 0 && wholes < 3000, `fuzz: some inputs stay whole and some split (${wholes} of 3000 whole) - the allowlist is neither everything nor nothing`);
}

/* ================================================================== *
 * 2. The bank as it stands
 * ================================================================== */
{
  let recordsTotal = 0, withSource = 0, oldKeyLeft = 0, emptyArr = 0, sites0 = 0;
  for (const site of WAVE3) {
    const owners = site.owners(bank);
    if (!owners.length) sites0++;
    let sw = 0;
    for (const { owner } of owners) {
      recordsTotal++;
      if (owner[site.field] !== undefined) { withSource++; sw++; }
      if (site.oldField !== site.field && owner[site.oldField] !== undefined) oldKeyLeft++;
      if (Array.isArray(owner[site.field]) && owner[site.field].length === 0) emptyArr++;
    }
    check(sw > 0, `${site.id}: has citations in the bank (${sw} of ${owners.length} records)`, "no record in this collection carries a source[] any more");
  }
  check(sites0 === 0, "every Wave 3 collection was found in the assembled bank (the walker in tools/cite-schema.mjs still matches their shape)");
  check(oldKeyLeft === 0, "no record in a migrated collection still has its old free-text key (cite / ref / reference / citation)", () => oldKeyLeft + " record(s) do");
  check(emptyArr === 0, "no migrated record has an empty source[] (no citation means no key)");
}
{
  // Wave 1's collections, on the assembled bank - a pack that injects the old {ref,para,asOf} shape is exactly what shipped in v1.16.0
  const badScen = (bank.scenarios.scenarios || []).filter((s) => Array.isArray(s.doctrine) && s.doctrine.some((d) => d && typeof d === "object" && (d.ref !== undefined || typeof d.pub !== "string")));
  check(badScen.length === 0, "no scenario (static or from a content pack) still cites doctrine in the old {ref, para, asOf} shape", () => badScen.map((s) => s.id).join(", "));
}

/* ================================================================== *
 * 3. The lint, with defects planted in copies of the seed
 * ================================================================== */
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "guidon-cite-"));
const tmpSeed = path.join(tmpDir, "index.html");
const lint = (mutate) => {
  copyFileSync(SEED, tmpSeed);
  if (mutate) { const { data } = readSeed(tmpSeed); mutate(data); writeSeed(data, tmpSeed); }
  const r = spawnSync(NODE, [path.join(HERE, "lint-citation-schema.mjs"), "--seed", tmpSeed], { encoding: "utf8", maxBuffer: 1 << 26 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
try {
  const clean = lint(null);
  check(clean.code === 0 && /all passed/.test(clean.out), "lint: a clean copy of the seed passes", () => clean.out.split("\n").filter((l) => /FAIL/.test(l)).slice(0, 4).join(" | "));
  // Each defect is planted on the first record that can carry it, found by shape - so reordering or adding content never breaks a plant.
  const firstWith = (arr, pred) => { const r = (arr || []).find(pred); if (!r) throw new Error("test-section-citations: no record to plant a defect on - the seed's shape moved"); return r; };
  const hasSrc = (o) => o && Array.isArray(o.source) && o.source.length > 0;
  const PLANTS = [
    ["the old free-text key comes back on an IDP goal template", (d) => { d.idp.goalTemplates[0].cite = "AR 350-1"; }, /idp\.goalTemplates .*still has the free-text "cite"/],
    ["a lesson's source is a plain string again", (d) => { firstWith(d.curriculum.courses.flatMap((c) => c.lessons), hasSrc).source = "ADP 6-22 (2019)"; }, /is not an array/],
    ["a counsel skill has an empty source[]", (d) => { firstWith(d.counsel.skills, hasSrc).source = []; }, /empty array/],
    ["a form use case has an invalid quoteKind", (d) => { firstWith(d.forms.forms.flatMap((f) => f.useCases || []), hasSrc).source[0].quoteKind = "quote"; }, /quoteKind is "quote"/],
    ["PRT's cadenceOverride.source is back in the old {ref, para, asOf} shape", (d) => { firstWith(d.prt.drills, (x) => (x.exercises || []).length).exercises[0].cadenceOverride = { cadence: "slow", note: "x", source: { ref: "ATP 7-22.02", para: null, asOf: null } }; }, /prt\.cadenceOverride .*is not an array/],
    ["a punctuation key is not a string", (d) => { firstWith(d.idp.planner7906, hasSrc).source[0].sepAfter = 5; }, /sepAfter is not a string/],
    ["a ninth form names its citation `ref` (which no screen shows)", (d) => { firstWith(d.forms.forms, hasSrc).ref = "AR 623-3"; }, /other than the 8 known ones/],
    ["a scenario cites doctrine in the old {ref, para, asOf} shape", (d) => { firstWith(d.scenarios.scenarios, (sc) => Array.isArray(sc.doctrine) && sc.doctrine.length && typeof sc.doctrine[0] === "object").doctrine = [{ ref: "ADP 6-22", para: "", asOf: "2019-07" }]; }, /old \{ref, para, asOf\} shape/],
    ["a doctrine entry gets a top-level `ref` back", (d) => { d.doctrine.entries[0].ref = "AR 600-20"; }, /top-level "ref"/],
  ];
  for (const [what, mutate, expectMsg] of PLANTS) {
    const r = lint(mutate);
    check(r.code === 1 && expectMsg.test(r.out), `lint: fails when ${what}`, () => `exit ${r.code}; ` + (r.out.split("\n").filter((l) => /FAIL/.test(l)).slice(0, 2).join(" | ") || r.out.slice(0, 200)));
  }

  /* ============================================================== *
   * 4. The migrator: legacy text in, arrays that render the same out
   * ============================================================== */
  copyFileSync(SEED, tmpSeed);
  const data = readSeed(tmpSeed).data;
  const legacyInputs = TABLE.map((r) => r[0]);
  const chosen = [];
  let k = 0;
  for (const site of WAVE3) {
    let n = 0;
    for (const { owner, path: p } of site.owners(data)) {
      if (n >= 2 || owner[site.field] === undefined) continue;
      const legacy = legacyInputs[k++ % legacyInputs.length];
      if (site.oldShape === "object") owner[site.field] = { ref: legacy, para: null, asOf: null };
      else if (site.oldField === site.field) owner[site.field] = legacy;
      else { delete owner[site.field]; owner[site.oldField] = legacy; }
      chosen.push({ site, p, legacy });
      n++;
    }
  }
  writeSeed(data, tmpSeed);
  const regressed = readSeed(tmpSeed);
  const run = (...a) => spawnSync(NODE, [path.join(HERE, "migrate-citations-wave3.mjs"), "--seed", tmpSeed, ...a], { encoding: "utf8", maxBuffer: 1 << 26 });
  const pending = run("--check");
  check(pending.status === 1 && /still free text/.test(pending.stdout), `migrator --check: fails while ${chosen.length} record(s) are still free text`, () => pending.stdout.slice(-200));
  const asIs = readFileSync(tmpSeed, "utf8");
  const dry = run("--report");
  check(dry.status === 0 && readFileSync(tmpSeed, "utf8") === asIs, "migrator --report: prints the plan and changes nothing", () => dry.stdout.slice(-200));
  const applied = run();
  check(applied.status === 0 && /wrote /.test(applied.stdout), "migrator: applies cleanly", () => applied.stdout.slice(-300) + applied.stderr.slice(-300));
  const after = readSeed(tmpSeed);
  let renderWrong = 0;
  for (const { site, p, legacy } of chosen) {
    let o = after.data; for (const key of p) o = o[key];
    if (renderCitation(o.source) !== legacy) renderWrong++;
    if (site.oldField !== site.field && o[site.oldField] !== undefined) renderWrong++;
  }
  check(renderWrong === 0, `migrator: every one of ${chosen.length} migrated records renders back to its original text and lost its old key`, () => renderWrong + " wrong");
  // everything else is untouched: strip the touched records' citation keys from both sides and compare the rest
  const strip = (d) => { for (const { site, p } of chosen) { let o = d; for (const key of p) o = o[key]; delete o[site.field]; delete o[site.oldField]; } return d; };
  const orig = readSeed(SEED).data;
  check(same(strip(after.data), strip(orig)), "migrator: nothing but those citations changed anywhere in the seed");
  check(asIs.replace(regressed.raw, "") === readFileSync(tmpSeed, "utf8").replace(after.raw, ""), "migrator: every byte of the file outside the seed line is identical");
  const again = run("--check");
  check(again.status === 0 && /CHECK OK/.test(again.stdout), "migrator: a second run finds nothing left to do (idempotent)");
  const real = spawnSync(NODE, [path.join(HERE, "migrate-citations-wave3.mjs"), "--check"], { encoding: "utf8", maxBuffer: 1 << 26 });
  check(real.status === 0 && /CHECK OK/.test(real.stdout), "migrator --check on the real seed: every Wave 3 citation is already structured", () => real.stdout.slice(-200));
} finally {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* a leftover temp dir is harmless */ }
}

/* ================================================================== *
 * 5. No reader in src/ still reads an old field
 * ================================================================== */
{
  const OLD_READERS = [
    /\blesson\.citation\b/, /\bl\.citation\b/, /\bf\.reference\b/, /\buc\.ref\b/, /\bsk\.ref\b/, /\be\.ref\b/,
    /\bt\.cite\b/, /\bv\.cite\b/, /\bp\.cite\b/, /\bgt\.cite\b/, /\bre\.cite\b/, /\bsn\.cite\b/, /\bL\.cite\b/, /\bfh\.cite\b/,
    /(?:job_offer_checklist|negotiation_planner|skills_comparison)\.cite\b/, /\bcourse\.source\s*\|\|/,
  ];
  const files = [SEED, ...readdirSync(path.join(APP, "src/app-modules")).filter((f) => f.endsWith(".js")).map((f) => path.join(APP, "src/app-modules", f))];
  const hits = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (line.length > 3000) return; // the 6 MB seed line and the vendored, minified libraries (pdf.js, ...)
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      // `e.ref` in pt-planner.js and room-schema.js is a PT-plan entry's session key (the Study Rooms hand-off), not a citation
      const isPlanEntryRef = /(?:pt-planner|room-schema)\.js$/.test(f);
      for (const rx of OLD_READERS) if (rx.test(line) && !(isPlanEntryRef && rx.source === "\\be\\.ref\\b")) hits.push(`${path.relative(APP, f)}:${i + 1} ${rx}`);
    });
  }
  check(hits.length === 0, "no code in src/ reads a Wave 3 citation from its old field name", () => hits.slice(0, 5).join(" | "));
}

/* ================================================================== *
 * 6. The real app
 * ================================================================== */
const boot = await bootApp({ profile: { ...PERSONAL_PROFILE }, viewport: { width: 1280, height: 900 } });
const { page, noise } = boot;
const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await page.evaluate(() => { window.__printed = []; window.G.util.printHTML = (t, h) => { window.__printed.push({ t, h }); }; });

// --- G.util.citeText (the page) agrees with renderCitation (this suite's node twin) on EVERY record, and on the parser table
{
  const items = [];
  for (const site of WAVE3) for (const { owner, path: p } of site.owners(bank)) items.push({ site: site.id, path: p, expected: renderCitation(owner[site.field]) });
  const wrong = await page.evaluate((items) => {
    const seed = window.G.store.seed(), out = [];
    for (const it of items) {
      let o = seed; for (const k of it.path) o = o == null ? o : o[k];
      const got = o ? window.G.util.citeText(o.source) : "<no such record in the page>";
      if (got !== it.expected) out.push(it.site + " " + it.path.join(".") + ": " + JSON.stringify(got) + " vs " + JSON.stringify(it.expected));
    }
    return out;
  }, items);
  check(items.length > 0 && wrong.length === 0, `G.util.citeText and tools/cite-schema.mjs agree on all ${items.length} Wave 3 records in the live app`, () => wrong.slice(0, 3).join(" | "));
  const tableWrong = await page.evaluate((rows) => rows.filter(([input, entries]) => window.G.util.citeText(entries) !== input).map((r) => r[0]), TABLE.map(([input]) => [input, parseLegacyCitation(input).entries]));
  check(tableWrong.length === 0, "G.util.citeText re-renders every legacy shape in the parser table to its exact original text", () => tableWrong.join(" | "));
  const edge = await page.evaluate(() => [window.G.util.citeText(undefined), window.G.util.citeText(null), window.G.util.citeText([]), window.G.util.citeText("as typed"), window.G.util.citeText([null, { pub: "AR 1-1" }])]);
  check(same(edge, ["", "", "", "as typed", "AR 1-1"]), "G.util.citeText: a missing source is \"\", never \"undefined\" or \"[object Object]\"", () => JSON.stringify(edge));
  // The Wave 1 bare-number bridge, in the page (the twin of the same table in the Node half above)
  const w1Live = await page.evaluate((rows) => rows.map(([source]) => window.G.util.citeText(source)), WAVE1_SHAPES);
  const w1Wrong = WAVE1_SHAPES.map(([, want], i) => (w1Live[i] === want ? null : JSON.stringify(w1Live[i]) + " vs " + JSON.stringify(want))).filter(Boolean);
  check(w1Wrong.length === 0, "G.util.citeText words a Wave 1 bare paragraph number (\"ATP 7-22.02, para 3-3\", never \"ATP 7-22.02, 3-3\") and leaves worded locators and explicit paraSep alone, exactly like renderCitation", () => w1Wrong.join(" | "));
}

// --- Learn: the course line, every lesson row, every lesson reader, the print sheet
{
  await waitForRoute(page, "#/learn", { fresh: true, ready: ".list-detail-row" });
  const wrong = [];
  let lessonsChecked = 0;
  for (const course of bank.curriculum.courses) {
    const got = await page.evaluate((id) => {
      window.__printed.length = 0;
      document.querySelector('.list-detail-row[data-course-id="' + id + '"]').click();
      const pane = document.getElementById("learn-detail-pane");
      const printBtn = [...pane.querySelectorAll("button")].find((b) => /Print study sheet/.test(b.textContent));
      printBtn.click();
      return { hint: pane.querySelector(".hint").textContent, metas: [...pane.querySelectorAll(".card.click > div.meta")].map((m) => m.textContent), print: window.__printed.map((p) => p.h).join("") };
    }, course.id);
    const wantHint = (course.summary || "") + "  ·  Source: " + cite(course);
    if (got.hint !== wantHint) wrong.push(`${course.id} course line ${JSON.stringify(got.hint.slice(-80))}`);
    const lessons = course.lessons || [];
    if (got.metas.length !== lessons.length) wrong.push(`${course.id} shows ${got.metas.length} lesson rows, expected ${lessons.length}`);
    lessons.forEach((l, i) => { if (got.metas[i] !== "~" + (l.estMin || 3) + " min · " + cite(l)) wrong.push(`${course.id} lesson ${i} row ${JSON.stringify(got.metas[i])}`); });
    if (!got.print.includes("<p style='color:#555'>Source: " + esc(cite(course)) + "</p>")) wrong.push(`${course.id} print sheet lacks its Source line`);
    lessons.forEach((l, i) => { if (!got.print.includes("<p style='margin:2px 0;font-size:12px;color:#555'>" + esc(cite(l)) + "</p>")) wrong.push(`${course.id} print sheet lesson ${i}`); });
    for (let i = 0; i < lessons.length; i++) {
      await page.evaluate((i) => document.querySelectorAll("#learn-detail-pane .card.click")[i].click(), i);
      await until(page, () => [...document.querySelectorAll("#route .meta")].some((m) => /^Citation:/.test(m.textContent)));
      const line = await page.evaluate(() => [...document.querySelectorAll("#route .meta")].find((m) => /^Citation:/.test(m.textContent)).textContent);
      if (line !== "Citation: " + (cite(lessons[i]) || "—")) wrong.push(`${course.id} lesson ${i} reader ${JSON.stringify(line)}`);
      lessonsChecked++;
      await page.evaluate(() => [...document.querySelectorAll("#route button")].find((b) => /^‹ /.test(b.textContent)).click());
      await until(page, (id) => !!document.querySelector('.list-detail-row.active[data-course-id="' + id + '"]') && document.querySelectorAll("#learn-detail-pane .card.click").length > 0, course.id);
    }
  }
  check(wrong.length === 0 && lessonsChecked > 0, `Learn: all ${bank.curriculum.courses.length} course lines, ${lessonsChecked} lesson rows, ${lessonsChecked} lesson readers and every print sheet show the citation exactly`, () => wrong.slice(0, 4).join(" | "));
}

// --- Forms: catalog tag, detail tag, use-case lines (Guided tab), the printed practice copy, search
{
  await waitForRoute(page, "#/forms", { fresh: true, ready: ".form-card" });
  const cardTags = await page.evaluate(() => [...document.querySelectorAll(".form-card")].map((c) => ({ num: c.querySelector(".form-num").textContent, tag: (c.querySelector(".tag.verified") || {}).textContent || "" })));
  const wrongCards = [];
  for (const f of bank.forms.forms) {
    const c = cardTags.find((x) => x.num.startsWith(f.form));
    if (!c || c.tag !== cite(f)) wrongCards.push(`${f.id} card tag ${JSON.stringify(c && c.tag)}`);
  }
  check(wrongCards.length === 0, `Forms catalog: each of ${bank.forms.forms.length} cards shows its reference tag exactly (or none)`, () => wrongCards.slice(0, 4).join(" | "));
  const wrong = [];
  for (const f of bank.forms.forms) {
    await page.evaluate((id) => { window.G.nav.seed("forms", id); }, f.id);
    await waitForRoute(page, "#/forms", { fresh: true, ready: ".form-body" });
    const head = await page.evaluate(() => (document.querySelector("#route .mini-row .tag.verified") || {}).textContent || "");
    if (head !== cite(f)) wrong.push(`${f.id} detail tag ${JSON.stringify(head)}`);
    const segs = await page.evaluate(() => [...document.querySelectorAll("#route .segmented button")].map((b) => b.textContent.trim()));
    const pick = async (label) => {
      const i = segs.indexOf(label);
      await page.evaluate((i) => document.querySelectorAll("#route .segmented button")[i].click(), i);
      await until(page, (i) => document.querySelectorAll("#route .segmented button")[i].getAttribute("aria-pressed") === "true", i);
    };
    await pick("Guided");
    const ucs = await page.evaluate(() => [...document.querySelectorAll("#route .uc-item")].map((r) => (r.querySelector(".uc-ref") || {}).textContent || ""));
    const wantUc = (f.useCases || []).map((u) => cite(u));
    if (!same(ucs, wantUc)) wrong.push(`${f.id} use-case refs ${JSON.stringify(ucs)} vs ${JSON.stringify(wantUc)}`);
    await pick("Fill");
    const printed = await page.evaluate(() => {
      window.__printed.length = 0;
      const b = [...document.querySelectorAll("#route .form-body button")].find((x) => /^Print$/.test(x.textContent.trim()));
      if (b) b.click();
      return window.__printed.map((p) => p.h).join("");
    });
    if (!printed.includes(" · " + esc(cite(f)) + " · PRACTICE COPY")) wrong.push(`${f.id} printed practice copy header`);
  }
  check(wrong.length === 0, `Forms: all ${bank.forms.forms.length} form screens show their reference tag, every use-case reference and the printed practice-copy header exactly`, () => wrong.slice(0, 4).join(" | "));
}

// --- Counsel, Health, Develop, Money, Write, Transition
async function tab(label) {
  await page.evaluate((label) => [...document.querySelectorAll("#route [role=tab]")].find((x) => x.textContent.trim() === label).click(), label);
  await until(page, (label) => { const t = [...document.querySelectorAll("#route [role=tab]")].find((x) => x.textContent.trim() === label); return !!t && (t.getAttribute("aria-selected") === "true" || t.classList.contains("active")); }, label);
  await frame();
}
const texts = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent.trim()), sel);
const sortedSame = (a, b) => same(a.slice().sort(), b.slice().sort());
{
  await waitForRoute(page, "#/counsel", { fresh: true, ready: ".skill-head" });
  const skillRefs = await texts("#route .skill-card .skill-ref");
  const wantSkills = bank.counsel.skills.map(cite).filter(Boolean);
  check(sortedSame(skillRefs, wantSkills), `Counsel: the ${wantSkills.length} counseling skills show their reference line exactly`, () => JSON.stringify(skillRefs.slice(0, 3)));
  await tab("Examples");
  const exRefs = await texts("#route .skill-card .skill-ref");
  const wantEx = bank.counsel.examples.map(cite).filter(Boolean);
  // the Examples tab draws a first page of them, so hold each DRAWN line to a real citation from the bank
  check(exRefs.length > 0 && exRefs.every((r) => wantEx.includes(r)), `Counsel: the ${exRefs.length} example counselings drawn show their reference line exactly`, () => `${exRefs.length} lines, first ${JSON.stringify(exRefs[0])}`);

  await waitForRoute(page, "#/health", { fresh: true, ready: "#route [role=tab]" });
  await tab("Daily Skills");
  const hRefs = await texts("#route .skill-ref");
  const wantH = bank.resilience.skills.map(cite).filter(Boolean);
  check(sortedSame(hRefs, wantH), `Health: the daily skills show their reference line exactly (${wantH.length} with one; a skill with none shows none)`, () => JSON.stringify(hRefs));

  await waitForRoute(page, "#/develop", { fresh: true, ready: "#route [role=tab]" });
  const tabsD = await texts("#route [role=tab]");
  let varRefs = [], planRefs = [];
  for (const t of tabsD) {
    await tab(t);
    varRefs = varRefs.concat(await texts("#route .idp-var .cite"));
    planRefs = planRefs.concat(await texts("#route .idp-planner-row .cite"));
  }
  check(same(varRefs, bank.idp.selfDevVariations.map(cite)), "Develop: the three self-development variations show their citation exactly", () => JSON.stringify(varRefs));
  check(same(planRefs, bank.idp.planner7906.map(cite).filter(Boolean)), "Develop: the DA 7906 planner rows show their citation exactly", () => JSON.stringify(planRefs));
  await tab("My IDP");
  await until(page, () => !!document.querySelector(".idp-suggest-chip"));
  const chips = await page.evaluate(() => [...document.querySelectorAll(".idp-suggest-chip")].map((c) => ({ title: c.querySelector(".idp-suggest-title").textContent, tip: c.getAttribute("title") })));
  const wrongChips = chips.filter((c) => { const t = bank.idp.goalTemplates.find((x) => x.title === c.title); return !t || c.tip !== (t.measure || "") + (cite(t) ? "  ·  " + cite(t) : ""); });
  check(chips.length > 0 && wrongChips.length === 0, `Develop: each of the ${chips.length} suggested goals carries its citation in its tooltip exactly`, () => JSON.stringify(wrongChips.slice(0, 2)));

  await waitForRoute(page, "#/money", { fresh: true, ready: "#route [role=tab]" });
  await tab("BRS & TSP");
  const notes = await texts("#route .fin-note");
  const wantLimits = "Source: " + cite(bank.finance.brs.limits2026);
  check(notes.includes(wantLimits), "Money: the 2026 contribution limits panel shows its source line exactly", () => JSON.stringify(notes));
  await tab("Salary Negotiation");
  const hints = await texts("#route .hint");
  const sn = bank.finance.salary_negotiation;
  check(hints.includes("Source: " + cite(sn)), "Money: Salary Negotiation shows its source line exactly", () => JSON.stringify(hints.slice(0, 3)));
  check(hints.includes(sn.job_offer_checklist.intro + " (" + cite(sn.job_offer_checklist) + ")") && hints.includes(sn.negotiation_planner.intro + " (" + cite(sn.negotiation_planner) + ")"),
    "Money: the job-offer checklist and the negotiation planner show their parenthesised citation exactly");

  await waitForRoute(page, "#/write", { fresh: true, ready: "#route [role=tab]" });
  await tab("Resume Example");
  const wHints = await texts("#route .hint");
  const re = bank.writing.resume_example;
  check(wHints.includes(re.bio + " Source: " + cite(re)), "Write: the resume example shows its source line exactly", () => JSON.stringify(wHints.slice(0, 2)));

  await waitForRoute(page, "#/transition", { fresh: true, ready: "#route [role=tab]" });
  await tab("Federal Hiring");
  const tHints = await texts("#route .hint");
  check(tHints.includes("Source: " + cite(bank.transition.federal_hiring)), "Transition: Federal Hiring shows its source line exactly", () => JSON.stringify(tHints.slice(0, 2)));
}

// --- Global Search: the meta / sub line of Forms, Counsel, Develop and Health hits
{
  await waitForRoute(page, "#/search", { fresh: true, ready: 'input[type="search"]' });
  const jobs = [];
  bank.forms.forms.forEach((f) => jobs.push({ chip: "Forms", query: f.form.trim(), need: [f.title, cite(f)] }));
  bank.counsel.skills.forEach((s) => jobs.push({ chip: "Counsel", query: s.name, need: [s.name, cite(s)] }));
  bank.idp.goalTemplates.forEach((t) => jobs.push({ chip: "Develop", query: t.title, need: [t.title, cite(t)] }));
  bank.resilience.skills.forEach((s) => jobs.push({ chip: "Health", query: s.name, need: [s.name, cite(s)] }));
  const wrong = [];
  for (const j of jobs) {
    const hits = await page.evaluate(({ query, chip }) => {
      const inp = document.querySelector('input[type="search"]');
      inp.value = query;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      const c = [...document.querySelectorAll(".search-chip")].find((b) => b.textContent.includes(chip));
      if (c) c.click();
      return [...document.querySelectorAll(".search-hit")].map((h) => h.textContent);
    }, { query: j.query, chip: j.chip });
    if (!hits.some((h) => j.need.every((n) => h.includes(n)))) wrong.push(`${j.chip} "${j.query}" -> no hit showing ${JSON.stringify(j.need[1])}`);
  }
  check(jobs.length > 0 && wrong.length === 0, `Global Search: ${jobs.length} Forms / Counsel / Develop / Health hits each show their citation exactly`, () => wrong.slice(0, 3).join(" | "));
}

// --- MOI Import: every form's citation reaches the coverage registry (it reads f.source through G.util.citeText)
{
  const res = await page.evaluate(() => {
    const M = window.G.moiImport, out = { forms: 0, missing: [] };
    for (const f of window.G.store.forms().forms) {
      const text = window.G.util.citeText(f.source);
      if (!text) continue;
      out.forms++;
      for (const tok of M.tokenizeCitations(text)) {
        const m = M.matchCitation(tok);
        if (m.tier === "unmatched" || !m.counts || m.counts.doctrineCards < 1) out.missing.push(f.id + ": " + tok);
      }
    }
    return out;
  });
  check(res.forms > 0 && res.missing.length === 0, `MOI Import: the citations of all ${res.forms} forms that have one are counted in its coverage registry`, () => res.missing.slice(0, 4).join(" | "));
}

expectNoConsoleNoise(noise);
await finish("SECTION CITATIONS");
