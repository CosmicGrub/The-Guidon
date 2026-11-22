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

// Any object in the assembled bank with this id / name (courses, lessons, scenarios, counsel skills...).
const index = new Map();
(function walk(o) {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { o.forEach(walk); return; }
  for (const k of ["id", "name"]) if (typeof o[k] === "string" && !index.has(k + ":" + o[k])) index.set(k + ":" + o[k], o);
  Object.values(o).forEach(walk);
})(data);
const byId = (id) => index.get("id:" + id);
const byName = (n) => index.get("name:" + n);
const s = (v) => (typeof v === "string" ? v : JSON.stringify(v == null ? "" : v));
const entry = (rec, pub) => (rec && Array.isArray(rec.source) ? rec.source.find((e) => e.pub === pub) : undefined);

// --- the whole-source sweep: the old wrong claims may not come back anywhere --
const FORBIDDEN = [
  ["RG-03: 'DA Form 3355' is not in the 6 Mar 2026 AR 600-8-19", /DA Form 3355/],
  ["RG-03: 'DA 3355' shorthand", /\bDA 3355\b/],
  ["RG-01: the commander submits a DA Form 4187 to deny an automatic promotion", /submit(ting)? a DA Form 4187 to deny|deny (it |the promotion |an automatic promotion )?via DA 4187/i],
  ["RG-02: semi-centralized taught as E4 to E6 / SPC to SSG", /Semi-Centralized: E4 to E6|Semi-Centralized \(E4-E6/],
  ["RG-02: decentralized taught as E1 to E3 (PVT to PFC)", /Decentralized: E1 to E3|Decentralized \(E1-E3/],
  ["RG-02: decentralized taught as 'unit-level ... within promotion points established by HRC'", /managed by unit commanders within promotion points established by HRC/],
  ["RG-02: decentralized as 'E1-E4 (unit authority)'", /E1-E4: decentralized \(unit authority\)/],
  ["RG-02: 'PV1 through SPC'", /PV1 through SPC/],
  ["RG-02: 'the unit commander promotes based on time-in-service' (decentralized is automatic)", /the unit commander promotes based on time-in-service/],
  ["RG-04: 'reissued 25 Oct 2023' edition label", /reissued 25 Oct 2023/],
  ["RG-05: the cited paragraph is 3-17a, not 3-18a(2)", /para 3-18a\(2\)/],
  ["RG-05: 'Commandant's List limited to the top 20%' (not in the bundled text)", /top 20 ?(%|percent)/i],
  ["RG-05: 'Honor Graduate ... Iron Soldier ... 5 promotion points' (not in the bundled text)", /Iron Soldier each|Writing Award and Iron Soldier/],
  ["RG-05: 'any negative counseling makes you ineligible for all six'", /ineligible for all six|any negative counseling disqualifies you/i],
  ["RG-05: 'Distinguished Honor Graduate - highest GPA - 40'", /highest GPA \\u2014 40|Distinguished Honor Graduate \(highest GPA\)|Distinguished Honor Graduate — highest GPA|determined by NCOA SOP; 40/],
  ["RG-03: DA Pam 600-25 as the promotion-point source", /Per DA Pam 600-25( \(current edition\))?: (PPW|promotion point|the PPW)|verify current DA Pam 600-25|calculated in DA Pam 600-25/],
  ["RG-06: initial counseling 'within 30 days of a Soldier reporting to a unit'", /within 30 days of a Soldier reporting to a unit/],
  ["RG-06: initial counseling 'within the first 30 days of a new duty assignment'", /(within )?(the )?first 30 days of a new duty assignment/],
  ["RG-06: 'initial counseling within 30 days of a Soldier joining the unit'", /initial counseling within 30 days of a Soldier joining the unit/i],
  ["RG-06: 'counsel them within the first 30 days' for a new Soldier", /you counsel them within the first 30 days/],
  ["RG-06: 'AR 600-20 requires it within 30 days of assignment' (wrong regulation AND the old claim)", /AR 600-20 requires it within 30 days/],
  ["RG-06: 'Initial counseling within 30 days of assignment' (ATP 6-22.1 does not say it)", /[Ii]nitial counseling within 30 days of assignment/],
  ["RG-06: 'initial counseling is required within 30 days. You are late at day 12'", /initial counseling is required within 30 days\. You are late/],
  ["RG-06: support form 'within 30 days of the rated NCO joining' / 'initiated within 30 days of joining'", /within 30 days of the rated NCO joining|initiated within 30 days of joining/],
  ["RG-05: BLC page 'DLG ... determined by NCOA SOP' (not in the bundled text)", /determined by NCOA SOP/],
  ["RG-05: BLC page Commandant's List 'receive NO negative counseling' / '21-40% band'", /receive NO negative counseling|and no negative counseling|next band \(21/],
  ["RG-06: 'within 30 days of new rating relationship'", /within 30 days of new rating relationship/],
  ["GP-01: 'SHARP counseling method' (SHARP is the prevention program; no such method)", /SHARP counseling method/],
];
for (const [label, re] of FORBIDDEN) {
  const hits = sources.filter(([, text]) => re.test(text)).map(([n]) => n);
  check(hits.length === 0, `no source carries: ${label}`, `${label} - found in ${hits.join(", ")}`);
}

// Each field is checked on its OWN, so one correct field cannot mask a reverted one.
const fieldHas = (label, rec, fields, re, negate = false) => {
  for (const f of fields) {
    const v = s(rec && rec[f]);
    const good = negate ? !re.test(v) : re.test(v);
    check(good, `${label}.${f} ${negate ? "does not match" : "matches"} ${re}`, `${label}.${f} ${negate ? "matches (old wording is back)" : "does not match"} ${re}: ${v.slice(0, 120)}`);
  }
};

// --- RG-01 ---------------------------------------------------------------------
{
  const q = board("bq18");
  check(!!q, "bq18 exists", "bq18 is missing");
  const F = ["a", "acceptableAnswer", "boardAnswer", "keyPoints"];
  fieldHas("bq18", q, F, /HR system of record/);
  fieldHas("bq18", q, F, /DA Form 4856/);
  fieldHas("bq18", q, F, /4187/, true);
  fieldHas("bq18", q, ["a", "acceptableAnswer", "boardAnswer"], /before the Soldier attains eligibility/);
  fieldHas("bq18", q, ["boardAnswer"], /\bafter the Soldier attains eligibility/, true);
  check(!!q && /2-1c/.test(q.source[0].para) && q.source[0].quoteKind === "paraphrase" && q.source[0].edition === "2026-03", "bq18: cited to para 2-1c, edition 2026-03, paraphrase", "bq18 citation is wrong");
  for (const id of ["promotion-tiers", "auto-promotion"]) {
    const d = doctrine(id);
    check(!!d, `${id} exists`, `${id} is missing`);
    fieldHas(id, d, ["body"], /HR system of record/);
    fieldHas(id, d, ["body"], /4856/);
    fieldHas(id, d, ["body"], /4187/, true);
  }
  fieldHas("auto-promotion", doctrine("auto-promotion"), ["body"], /before the Soldier attains eligibility/);
  { const pt = s(entry(doctrine("promotion-tiers"), "AR 600-8-19").para); check(/1-8/.test(pt) && /2-1/.test(pt) && /3-14/.test(pt), "promotion-tiers: AR 600-8-19 cited at 1-8, 2-1, 3-14 (not \"Ch 1-3\")", "promotion-tiers citation reverted"); }
  const ap = s(entry(doctrine("auto-promotion"), "AR 600-8-19").para);
  check(/2-1c/.test(ap) && !/\b2-3\b/.test(ap), "auto-promotion: cited to para 2-1c (not 2-3, waiver allocations)", "auto-promotion still cites 2-3");
}

// --- RG-02 / RG-03 doc-promotions ---------------------------------------------
{
  const d = doctrine("doc-promotions");
  check(!!d, "doc-promotions exists", "doc-promotions is missing");
  fieldHas("doc-promotions", d, ["body"], /Semi-Centralized: SGT and SSG \(E5 to E6\)/);
  fieldHas("doc-promotions", d, ["body"], /Decentralized: PV2, PFC and SPC \(E2 to E4\)/);
  fieldHas("doc-promotions", d, ["body"], /Centralized: E7 to E9 \(SFC to SGM\/CSM\)/);
  fieldHas("doc-promotions", d, ["body"], /SPC: 24 months TIS and 6 months TIG/);
  fieldHas("doc-promotions", d, ["body"], /military training[^.]*280 \/ 230[^.]*awards[^.]*145 \/ 165[^.]*military education[^.]*240 \/ 245[^.]*civilian education[^.]*135 \/ 160/);
  fieldHas("doc-promotions", d, ["body"], /Duty Performance|Point Scoring System|calculated in DA Pam/, true);
  fieldHas("doc-promotions", d, ["body"], /calculated automatically from your record in the HR system of record \(AR 600-8-19, para 3-14\)/);
  fieldHas("doc-promotions", d, ["boardAnswer"], /Decentralized \(PV2-SPC, E2-E4/);
  fieldHas("doc-promotions", d, ["boardAnswer"], /Semi-Centralized \(SGT and SSG, E5-E6/);
  fieldHas("doc-promotions", d, ["boardAnswer"], /Centralized \(SFC and above, E7-E9/);
  check(!entry(d, "DA Pam 600-25"), "doc-promotions: DA Pam 600-25 is not a source (the bundled pamphlet has no point scoring)", "doc-promotions cites DA Pam 600-25 again");
  const ar = entry(d, "AR 600-8-19");
  check(!!ar && /1-8/.test(ar.para) && /2-1a/.test(ar.para) && /3-14/.test(ar.para) && /3-18/.test(ar.para), "doc-promotions: AR 600-8-19 cited at 1-8, 2-1a, 3-14 to 3-18", "doc-promotions AR citation lost a paragraph");
}

// --- RG-03 / RG-04 -------------------------------------------------------------
{
  const q = board("bq17");
  const F = ["q", "a", "acceptableAnswer", "boardAnswer", "concept", "keyPoints"];
  check(!!q, "bq17 exists", "bq17 is missing");
  fieldHas("bq17", q, ["a", "acceptableAnswer", "boardAnswer"], /automated promotion point worksheet/);
  fieldHas("bq17", q, ["a", "acceptableAnswer", "boardAnswer"], /HR system of record/);
  fieldHas("bq17", q, F, /3355|What form is/, true);
  const ar = q && q.source[0];
  for (const [id, rec] of [["bq17", q], ["bq18", board("bq18")], ["boardprocedu-13", board("boardprocedu-13")]]) check(!!rec && /^para /.test(rec.source[0].para), `${id}: the locator is written "para N" (a bare number fails test:section-citations)`, `${id} locator is a bare number`);
  check(!!ar && /1-9b/.test(ar.para) && /3-14/.test(ar.para) && /3-17/.test(ar.para) && ar.quoteKind === "paraphrase", "bq17: cited at paras 1-9b, 3-14, 3-17 as a paraphrase", "bq17 citation is wrong");
  for (const id of ["promotion-tiers", "doc-promotions", "doc-prom-3"]) {
    const d = doctrine(id);
    fieldHas(id, d, ["body"], /HR system of record/);
    fieldHas(id, d, ["body"], /3355/, true);
  }
  const p3 = doctrine("doc-prom-3");
  fieldHas("doc-prom-3", p3, ["body"], /Decentralized promotions: PV2, PFC and SPC \(E-2 to E-4\)[^.]*automatic/);
  check(/2-1a/.test(s(entry(p3, "AR 600-8-19").para)) && /1-8/.test(s(entry(p3, "AR 600-8-19").para)), "doc-prom-3: AR 600-8-19 cited at 1-8, 2-1a, 3-14", "doc-prom-3 citation lost a paragraph");
  fieldHas("doc-prom-3", p3, ["keyPoints"], /PV2-SPC \(E2-E4\): decentralized \(automatic on TIS\/TIG\)/);
  const b13 = board("boardprocedu-13");
  fieldHas("boardprocedu-13", b13, ["a", "boardAnswer"], /Enlisted Promotions and Demotions, 6 March 2026 edition/);
  fieldHas("boardprocedu-13", b13, ["a", "boardAnswer"], /25 Oct 2023/, true);
  const e = entry(b13, "AR 600-8-19");
  check(!!e && /3-11/.test(e.para) && e.quoteKind === "paraphrase" && e.edition === "2026-03", "boardprocedu-13: AR 600-8-19 cited at para 3-11, edition 2026-03, paraphrase", "boardprocedu-13 AR citation is wrong");
  // prom-1: decentralized is automatic, E2-E4
  const p1 = board("prom-1");
  fieldHas("prom-1", p1, ["a", "acceptableAnswer", "boardAnswer", "keyPoints"], /promotion is automatic on time-in-service\/time-in-grade once the Soldier is eligible/);
  fieldHas("prom-1", p1, ["a", "boardAnswer"], /CPL E2-E4/);
}

// --- RG-05 ---------------------------------------------------------------------
{
  const d = doctrine("ncopds-honours");
  check(!!d, "ncopds-honours exists", "ncopds-honours is missing");
  fieldHas("ncopds-honours", d, ["body"], /graduate BLC \(competing for SGT\) or ALC \(competing for SSG\)/);
  fieldHas("ncopds-honours", d, ["body"], /20 points for Commandant's List status/);
  fieldHas("ncopds-honours", d, ["body"], /40 points for Distinguished Honor Graduate or Distinguished Leadership Graduate/);
  fieldHas("ncopds-honours", d, ["body"], /DA Form 1059/);
  fieldHas("ncopds-honours", d, ["body"], /top 20 percent|Iron Soldier|Writing Award|negative counseling|5 via certificate/i, true);
  const e = d && d.source && d.source[0];
  check(!!e && e.pub === "AR 600-8-19" && e.para === "3-17a" && e.quoteKind === "paraphrase" && e.edition === "2026-03", "ncopds-honours: cited as AR 600-8-19 para 3-17a, edition 2026-03, paraphrase (pub and para separate)", "ncopds-honours citation is wrong");
}

// --- DA Pam 600-25 is not a promotion-point source (the sgb lessons) ----------
{
  for (const id of ["sgb-l1", "sgb-l2", "sgb-l6"]) {
    const l = byId(id);
    check(!!l, `${id} exists`, `${id} is missing`);
    fieldHas(id, l, ["body", "tiers", "source"], /DA Pam 600-25/, true);
  }
  const l1 = byId("sgb-l1"), l2 = byId("sgb-l2"), l6 = byId("sgb-l6");
  check(/3-15 to 3-18/.test(s(l1 && l1.tiers && l1.tiers.intermediate)) && /3-15 to 3-18/.test(s(l1 && l1.body)), "sgb-l1: the point categories are sourced to AR 600-8-19 paras 3-15 to 3-18", "sgb-l1 lost the AR 600-8-19 re-source");
  check(/3-14 to 3-18/.test(s(l2 && l2.body)) && /para 3-14/.test(s(l6 && l6.body)), "sgb-l2 / sgb-l6: re-sourced to AR 600-8-19 paras 3-14 to 3-18 / 3-14", "sgb-l2 / sgb-l6 lost the AR 600-8-19 re-source");
}

// --- RG-06 ---------------------------------------------------------------------
{
  for (const [id, fields] of [["doc-counseling-purpose-and-standard-timeline", ["body"]], ["doc-counsel-4", ["body", "keyPoints"]]]) {
    const d = doctrine(id);
    check(!!d, `${id} exists`, `${id} is missing`);
    fieldHas(id, d, fields, /30 days after the beginning of the rating period/);
    const e = entry(d, "AR 623-3");
    check(!!e && e.para === "1-8e" && e.edition === "2025-02", `${id}: AR 623-3 cited at para 1-8e, edition 2025-02`, `${id} AR 623-3 citation is wrong`);
  }
  fieldHas("doc-counsel-4", doctrine("doc-counsel-4"), ["body"], /quarterly/);
  fieldHas("doc-counsel-4", doctrine("doc-counsel-4"), ["body"], /before the rating period begins/, true);
  const skill = byName("Initial (first-duty) counseling — what to cover");
  check(!!skill, "counsel skill 'Initial (first-duty) counseling' exists", "counsel skill 'Initial (first-duty) counseling' is missing");
  fieldHas("counsel skill", skill, ["body"], /AR 623-3, para 1-8e, requires initial counseling within 30 days after the beginning of the rating period/);
  fieldHas("counsel skill", skill, ["body"], /AR 600-20/, true);
  check(!entry(skill, "AR 600-20") && !!entry(skill, "AR 623-3") && /1-8e/.test(entry(skill, "AR 623-3").para), "counsel skill: cited to AR 623-3 para 1-8e (not AR 600-20 Ch 6)", "counsel skill citation is wrong");
  const be = board("bq-eval-02");
  fieldHas("bq-eval-02", be, ["keyPoints"], /within 30 days after the beginning of the rating period/);
  const nc = doctrine("doc-ncoer-rating");
  fieldHas("doc-ncoer-rating", nc, ["body"], /Required in conjunction with counseling; initial counseling is due within 30 days after the beginning of the rating period/);
  fieldHas("doc-ncoer-rating", nc, ["boardAnswer"], /is required in conjunction with counseling, and initial counseling is due within 30 days after the beginning of the rating period/);
  const di = byId("d-initial");
  check(!!di && s(di.doctrine).indexOf("30 days") === -1 && s(di.doctrine).indexOf("2-1") !== -1, "d-initial: the doctrine reference no longer claims a 30-day rule", "d-initial doctrine still claims a 30-day rule");
}

// --- GP-01 sc-late-soldier -----------------------------------------------------
{
  const sc = byId("sc-late-soldier");
  const ch = sc && sc.nodes && sc.nodes.n1 && sc.nodes.n1.choices;
  check(!!ch && ch.length === 3, "sc-late-soldier n1 has 3 choices", "sc-late-soldier n1 is missing choices");
  if (ch && ch.length === 3) {
    fieldHas("late[0]", ch[0], ["feedback"], /para 4-6a/);
    fieldHas("late[0]", ch[0], ["feedback"], /para 2-11/);
    fieldHas("late[0]", ch[0], ["feedback"], /requires leaders to address|documents your awareness/, true);
    fieldHas("late[1]", ch[1], ["feedback"], /para 4-6b\(1\)/);
    fieldHas("late[1]", ch[1], ["feedback"], /para 4-6b\(3\)/);
    fieldHas("late[1]", ch[1], ["feedback"], /nonjudicial punishment/);
    fieldHas("late[1]", ch[1], ["feedback"], /punishment for show/, true);
    fieldHas("late[2]", ch[2], ["feedback"], /para 4-6a\)/);
    fieldHas("late[2]", ch[2], ["feedback"], /4-6c/, true);
    fieldHas("late[2]", ch[2], ["feedback"], /ATP 6-22\.1, para 2-11/);
    const docs = s(sc.doctrine);
    check(/AR 600-20/.test(docs) && /4-6a, 4-6b/.test(docs) && /"ATP 6-22\.1"[^}]*"para":"2-11"/.test(docs), "sc-late-soldier: doctrine lists AR 600-20 4-6a/4-6b and ATP 6-22.1 2-11", "sc-late-soldier doctrine array lost AR 600-20 / ATP 6-22.1");
    fieldHas("sc-late-soldier", sc, ["learningObjective"], /SHARP/, true);
  }
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
