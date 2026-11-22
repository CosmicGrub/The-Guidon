/**
 * Content corrections 1.18.1 - promotion, counseling and academy honours.
 *
 * WHY THIS SUITE EXISTS. The 2026-11 regulation audit (refinement-2026-11/
 * regulations/REPORT.md) read the bundled AR 600-8-19 (6 March 2026, effective
 * 6 April 2026, retitled "Promotions and Demotions") and AR 623-3 (14 February
 * 2025) against what the app teaches and found statements a Soldier could act
 * on that the bundled text contradicts. Each is pinned here, MUTATION-STYLE:
 * every check below FAILS if the old wrong wording returns, and a second set
 * FAILS if the corrected fact is lost. The bundled paragraphs the corrections
 * rest on:
 *
 *   RG-01  AR 600-8-19 para 2-1c: "A CDR may deny automatic promotion by taking
 *          action within the HR system of record to deny the automatic promotion
 *          prior to the date the Soldier attains eligibility. (1) The first-line
 *          leader must counsel the Soldier, using DA Form 4856 ..." (a DA Form
 *          4187 appears nowhere in the regulation).
 *   RG-02  paras 1-8b/c, 2-1a: semi-centralized = SGT and SSG; promotion to
 *          PV2, PFC and SPC is automatic; SFC and above is centralized.
 *   RG-03  paras 1-9b(1), 1-11, 3-14, 3-17: promotion points are calculated
 *          automatically in the HR system of record and appear on "the
 *          automated promotion point worksheet"; "DA Form 3355" is not in the
 *          2026 regulation.
 *   RG-04  title block: 6 March 2026, "Enlisted Promotions and Demotions".
 *   RG-05  para 3-17a: Commandant's List = 20 points; Distinguished Honor
 *          Graduate / Distinguished Leadership Graduate = 40 points (BLC for
 *          SGT, ALC for SSG; verified on DA Form 1059). No top-20-percent cap,
 *          5-point items or negative-counseling bar appear in the text.
 *   RG-06  AR 623-3 para 1-8e: "Counseling will be conducted within 30 days
 *          after the beginning of the rating period, and quarterly thereafter".
 *
 * No browser: the records come through the same assembler every lint uses and
 * the raw source files are scanned as text.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleBank } from "./assemble-bank.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail || pass));

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const MODULES = path.join(SRC, "app-modules");
// library.js is the bundled publication text itself (verbatim extracts) - never edited here.
const sources = [
  ["src/index.html", fs.readFileSync(path.join(SRC, "index.html"), "utf8")],
  ...fs.readdirSync(MODULES).filter((f) => f.endsWith(".js") && f !== "library.js").map((f) => ["src/app-modules/" + f, fs.readFileSync(path.join(MODULES, f), "utf8")]),
];

const bank = await assembleBank();
const data = bank.data;
const find = (arr, id) => (Array.isArray(arr) ? arr.find((r) => r && r.id === id) : undefined);
const board = (id) => find(data.board && data.board.questions, id) || find(data.board, id) || find(data.boardQuestions, id);
const doctrineList = (data.doctrine && (data.doctrine.entries || data.doctrine)) || [];
const doctrine = (id) => find(Array.isArray(doctrineList) ? doctrineList : [], id);
const all = (r) => JSON.stringify(r || {});

// --- the whole-source sweep: the old wrong claims may not come back anywhere --
const FORBIDDEN = [
  ["RG-03: 'DA Form 3355' is not in the 6 Mar 2026 AR 600-8-19", /DA Form 3355/],
  ["RG-03: 'DA 3355' shorthand", /\bDA 3355\b/],
  ["RG-01: the commander submits a DA Form 4187 to deny an automatic promotion", /submit(ting)? a DA Form 4187 to deny|deny (it |the promotion |an automatic promotion )?via DA 4187/i],
  ["RG-02: semi-centralized taught as E4 to E6 / SPC to SSG", /Semi-Centralized: E4 to E6|Semi-Centralized \(E4-E6/],
  ["RG-02: decentralized taught as E1 to E3 (PVT to PFC)", /Decentralized: E1 to E3|Decentralized \(E1-E3/],
  ["RG-04: 'reissued 25 Oct 2023' edition label", /reissued 25 Oct 2023/],
  ["RG-05: the cited paragraph is 3-17a, not 3-18a(2)", /para 3-18a\(2\)/],
  ["RG-06: initial counseling 'within 30 days of a Soldier reporting to a unit'", /within 30 days of a Soldier reporting to a unit/],
  ["RG-06: initial counseling 'within the first 30 days of a new duty assignment'", /(within )?(the )?first 30 days of a new duty assignment/],
  ["RG-06: 'initial counseling within 30 days of a Soldier joining the unit'", /initial counseling within 30 days of a Soldier joining the unit/i],
  ["RG-06: 'counsel them within the first 30 days' for a new Soldier", /you counsel them within the first 30 days/],
];
for (const [label, re] of FORBIDDEN) {
  const hits = sources.filter(([, text]) => re.test(text)).map(([n]) => n);
  check(hits.length === 0, `no source carries: ${label}`, `${label} - found in ${hits.join(", ")}`);
}

// --- RG-01 ---------------------------------------------------------------------
{
  const q = board("bq18");
  const t = all(q);
  check(!!q, "bq18 exists", "bq18 is missing");
  check(/HR system of record/.test(t) && /DA Form 4856/.test(t) && /before the Soldier attains eligibility/.test(t), "bq18: denial is an HR-system action before eligibility, with DA Form 4856 counseling by the first-line leader", "bq18 lost the corrected denial procedure");
  check(!/4187/.test(t), "bq18: no DA Form 4187", "bq18 mentions DA Form 4187 again");
  check(q && q.source && q.source[0] && q.source[0].para === "2-1c" && q.source[0].quoteKind === "paraphrase", "bq18: cited to para 2-1c as a paraphrase", "bq18 citation is not para 2-1c / paraphrase");
  for (const id of ["promotion-tiers", "auto-promotion"]) {
    const d = doctrine(id);
    const dt = all(d);
    check(!!d && /HR system of record/.test(dt) && /DA Form 4856|4856/.test(dt) && !/4187/.test(dt), `${id}: denial is an HR-system action with DA Form 4856 counseling, no 4187`, `${id} is wrong or missing`);
  }
  check(/2-1c/.test(all(doctrine("auto-promotion").source)), "auto-promotion: cited to para 2-1c (not 2-3, which is waiver allocations)", "auto-promotion still cites the wrong paragraph");
}

// --- RG-02 ---------------------------------------------------------------------
{
  const d = doctrine("doc-promotions");
  const t = all(d);
  check(!!d, "doc-promotions exists", "doc-promotions is missing");
  check(/Semi-Centralized: SGT and SSG \(E5 to E6\)/.test(t), "doc-promotions: semi-centralized is SGT and SSG (E5 to E6)", "doc-promotions lost 'SGT and SSG (E5 to E6)'");
  check(/Decentralized: PV2, PFC and SPC \(E2 to E4\)/.test(t), "doc-promotions: decentralized is PV2, PFC and SPC (E2 to E4)", "doc-promotions lost 'PV2, PFC and SPC (E2 to E4)'");
  check(/Centralized \(SFC and above, E7-E9/.test(t), "doc-promotions: centralized is SFC and above", "doc-promotions lost the centralized tier");
  check(/1-8/.test(all(d && d.source)) && /2-1a/.test(all(d && d.source)), "doc-promotions: cited to paras 1-8 and 2-1a", "doc-promotions citation lost paras 1-8 / 2-1a");
}

// --- RG-03 / RG-04 -------------------------------------------------------------
{
  const q = board("bq17");
  const t = all(q);
  check(!!q && /automated promotion point worksheet/.test(t) && /HR system of record/.test(t), "bq17: points are calculated in the HR system of record on the automated promotion point worksheet", "bq17 lost the corrected worksheet answer");
  check(!/3355/.test(t), "bq17: no DA Form 3355", "bq17 mentions 3355 again");
  for (const id of ["promotion-tiers", "doc-promotions", "doc-prom-3"]) {
    const dt = all(doctrine(id));
    check(/HR system of record/.test(dt) && !/3355/.test(dt), `${id}: points come from the HR system of record, no DA Form 3355`, `${id} is wrong or missing`);
  }
  const b13 = board("boardprocedu-13");
  const bt = all(b13);
  check(!!b13 && /Promotions and Demotions, 6 March 2026 edition/.test(bt) && !/25 Oct 2023/.test(bt), "boardprocedu-13: names the 6 March 2026 edition (Promotions and Demotions)", "boardprocedu-13 edition label is wrong");
}

// --- RG-05 ---------------------------------------------------------------------
{
  const d = doctrine("ncopds-honours");
  const t = all(d);
  check(!!d, "ncopds-honours exists", "ncopds-honours is missing");
  check(/20 points for Commandant's List/.test(t) && /40 points for Distinguished Honor Graduate or Distinguished Leadership Graduate/.test(t) && /DA Form 1059/.test(t), "ncopds-honours: Commandant's List 20, DHG/DLG 40, verified on DA Form 1059", "ncopds-honours lost the supported point values");
  check(!/top 20 percent|Iron Soldier|Writing Award|negative counseling|5 via certificate/i.test(all(d && d.body)), "ncopds-honours: the unsupported items (top 20 percent, 5-point items, negative-counseling bar) are gone", "ncopds-honours carries an unsupported honours claim again");
  const s = d && d.source && d.source[0];
  check(!!s && s.pub === "AR 600-8-19" && s.para === "3-17a" && s.quoteKind === "paraphrase", "ncopds-honours: cited as AR 600-8-19 para 3-17a (pub and para separate)", "ncopds-honours citation is wrong");
}

// --- RG-06 ---------------------------------------------------------------------
{
  for (const id of ["doc-counseling-purpose-and-standard-timeline", "doc-counsel-4"]) {
    const d = doctrine(id);
    const t = all(d);
    check(!!d && /30 days after the beginning of the rating period, and quarterly/.test(t), `${id}: initial counseling is within 30 days after the beginning of the rating period, then quarterly`, `${id} lost the corrected counseling timeline`);
    const s = d && d.source && d.source.find((e) => e.pub === "AR 623-3");
    check(!!s && s.para === "1-8e" && s.edition === "2025-02", `${id}: AR 623-3 cited at para 1-8e, edition 2025-02`, `${id} AR 623-3 citation is wrong`);
  }
  check(!/before the rating period begins/.test(all(doctrine("doc-counsel-4"))), "doc-counsel-4: no longer says counseling happens before the rating period begins", "doc-counsel-4 again says counseling happens before the rating period begins");
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
