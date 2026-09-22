#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readSeed } from "./seed-io.mjs";
import { mergeContentPacks } from "./content-pack-engine.mjs";

const APP = fileURLToPath(new URL("../", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.html", import.meta.url));
// ROADMAP 3g E: the content packs this suite cares about (00-04,
// 06-opsec-cyber-curriculum-content) now run through the ONE real engine,
// tools/content-pack-engine.mjs - the same one tools/build.mjs bakes into
// the shipped seed - instead of a second, hand-rolled evaluator here. Only
// the two RUNTIME/feature modules (05-opsec-guard.js, its screening API;
// 06-opsec-cyber-curriculum.js, the #/cyber-opsec screen's own G.opsec.*
// surface) still run as plain <script>-style top-level code in this file's
// own lightweight sandbox - they own no seed data, so they are not part of
// the content-pack merge at all.
const RUNTIME_MODULES = [
  "src/app-modules/05-opsec-guard.js",
  "src/app-modules/06-opsec-cyber-curriculum.js",
];
let fails=0;
const ok=m=>console.log("  PASS  "+m);
const bad=m=>{fails++;console.error("  FAIL  "+m);};
const expect=(c,p,f=p)=>c?ok(p):bad(f);

const { data } = readSeed(INDEX);
// The dictionary exactly as the seed ships it, BEFORE any module touches it.
const termsBefore = new Map((data.acronyms?.terms||[]).map(t=>[String(t.a||"").toUpperCase(), { d:String(t.d||""), src:t.src }]));
const srcVocabulary = new Set([...termsBefore.values()].map(t=>t.src));
const local = new Map();
const documentMock = { readyState:"loading", addEventListener(){} };
const G = {};
const windowMock = { GUIDON_SEED:data, G };
const sandbox = {
  window: windowMock, G, console,
  document: documentMock,
  localStorage: { getItem:k=>local.get(k)||null, setItem:(k,v)=>local.set(k,String(v)) },
  setTimeout(){ return 0; }, clearTimeout(){},
};
windowMock.window=windowMock;
const ctx=vm.createContext(sandbox);

// Every "emit":"build" content pack (the real manifest, not a hand-picked
// subset) merges into `data` in place - running the full set is strictly
// MORE representative of the real shipped bank than isolating six files
// ever was, and every assertion below is unaffected by the other packs
// (they touch different ids/categories entirely; tools/lint-content-packs.mjs
// enforces that globally).
const merge = mergeContentPacks(data, APP + "src/app-modules");
const broken = merge.modules.filter(m => m.error);
if (broken.length) throw new Error("content pack(s) failed to merge: " + broken.map(m => `${m.file}: ${m.error}`).join("; "));

for(const rel of RUNTIME_MODULES) vm.runInContext(readFileSync(APP+rel,"utf8"),ctx,{filename:rel});

/* The sensitive-text check is FINDINGS ONLY: it reports what it saw and where,
   and never hands a caller edited text. (The first version rewrote its input,
   and "AR 600-20 2020" reached MOI Import's parser as "AR [SSN REDACTED]".)
   tools/test-opsec-guard.mjs proves the same table - and the screens built on
   it - inside the real page; this copy runs without a build, so the
   dedicated workflow gate covers the rules too. */
const guard=G.opsecGuard;
expect(!!guard && typeof guard.screen === "function", "the sensitive-text check is exported as G.opsecGuard.screen()");
expect(!!guard && guard.sanitizeInput === undefined && G.util?.sanitizeInput === undefined, "no text-rewriting API is exported any more (sanitizeInput is gone)");
const codes=(t,o)=>guard.screen(t,o).findings.map(f=>f.code+":"+f.severity).join(",");
expect(codes("SECRET//NOFORN")==="control-marking:stop", "a real control marking (SECRET//NOFORN) is a stop finding", codes("SECRET//NOFORN"));
expect(codes("CUI // SP-PRVCY")==="control-marking:stop", "a real CUI control marking is a stop finding", codes("CUI // SP-PRVCY"));
expect(codes("(S//NF) The unit departs.")==="portion-marking:stop" && codes("UNCLASSIFIED//FOUO")==="control-marking:stop", "portion marks and legacy FOUO control strings - which the first guard let through - are stop findings");
expect(codes("What are the three levels of classified information? Top Secret, Secret, and Confidential (AR 380-5).")==="" && codes("Is CUI classified information? No. CUI is unclassified information that requires safeguarding.")==="", "ordinary study text ABOUT markings produces no finding (the first guard hard-stopped both)");
const ssn=guard.screen("SSN 123-45-6789");
expect(ssn.text==="SSN 123-45-6789" && ssn.findings.length===1 && ssn.findings[0].code==="ssn" && ssn.findings[0].severity==="check" && !ssn.findings[0].excerpt.includes("123-45"), "a Social Security number is reported (masked in the excerpt) and the text is returned unchanged", JSON.stringify(ssn.findings));
for (const cite of ["AR 600-20 2020","AR 635-200 2021","References: AR 385-10 2023; AR 190-13 2019; DA PAM 600-25 2023."]) {
  const r=guard.screen(cite);
  expect(r.clean && r.text===cite, `a regulation followed by its year is not an ID or phone number: "${cite}"`, JSON.stringify(r.findings));
}
expect(codes("UIC W1ABCD")==="uic:note", "a labelled six-character UIC is noted", codes("UIC W1ABCD"));
expect(codes("DoD ID: 1234567890")==="dod-id:check" && codes("DA Form 4856, block 3: 1234567890.")==="", "a labelled 10-digit DoD ID/EDIPI is reported; an unlabelled ten-digit number in a form is not");
// Dates come from the real clock so this never depends on a year written into the rule or the test.
const D=new Date(), MON=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"], MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const day=n=>new Date(D.getFullYear(),D.getMonth(),D.getDate()+n), p2=n=>String(n).padStart(2,"0");
const army=d=>d.getDate()+" "+MON[d.getMonth()]+" "+d.getFullYear(), iso=d=>d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate());
expect(codes("Convoy movement to Fort Example training area on "+army(day(1))+", SP time 0600.")==="future-operation-location:check", "tomorrow's movement in the Army's own DD MON YYYY format is flagged for a deliberate look ("+army(day(1))+")");
expect(codes("Deployment movement on "+iso(day(1))+" at Fort Example training area")==="future-operation-location:check", "...and in ISO format ("+iso(day(1))+") - no year is written into the rule");
expect(codes("Deployment movement on "+iso(day(-40))+" at Fort Example training area")==="", "a movement that has already happened is not 'future' ("+iso(day(-40))+")");
expect(codes("The board convenes "+MONTHS[day(396).getMonth()]+" "+day(396).getDate()+", "+day(396).getFullYear()+" in the battalion conference room. Topics: land navigation grid coordinates.")==="", "a board's own date and room is not a unit movement (the first guard hard-stopped this sentence)");
expect(codes("Board study session on 2026-09-17")==="", "ordinary benign study text produces no finding");

// The whole fixture table (tools/test-opsec-guard.mjs runs the same rows in the built page).
const FIX=JSON.parse(readFileSync(APP+"tools/fixtures/opsec-guard-cases.json","utf8")).cases;
const forms=d=>({ISO:iso(d),US:(d.getMonth()+1)+"/"+d.getDate()+"/"+d.getFullYear(),LONG:MONTHS[d.getMonth()]+" "+d.getDate()+", "+d.getFullYear(),ARMY:army(d),ARMY2:d.getDate()+" "+MON[d.getMonth()]+" "+String(d.getFullYear()).slice(2),DTG:p2(d.getDate())+"0600Z"+MON[d.getMonth()]+String(d.getFullYear()).slice(2)});
const TOK={SOON:forms(day(1)),FAR:forms(day(396)),PAST:forms(day(-42))};
const fixBad=[];
for (const c of FIX) {
  const text=c.text.replace(/\{\{(SOON|FAR|PAST)_([A-Z0-9]+)\}\}/g,(_,w,k)=>TOK[w][k]);
  const r=guard.screen(text);
  const got=[...new Set(r.findings.map(f=>f.code))].sort().join(","), want=[...c.expect].sort().join(",");
  if (got!==want || r.text!==text || (c.severity && r.findings.some(f=>f.severity!==c.severity))) fixBad.push(`"${c.name}" got [${got}] expected [${want}]`);
}
expect(fixBad.length===0, `all ${FIX.length} rows of tools/fixtures/opsec-guard-cases.json produce exactly their expected findings and come back unedited`, fixBad.join(" | "));

/* The curriculum ADDS dictionary meanings; it never replaces one. It used to
   run `existing.d = ...; existing.src = "official"`, so AO lost "area of
   operations", ATO lost "air tasking order; antiterrorism officer", PII lost
   its seed meaning, and 20 entries carried a source tag the Dictionary had
   never heard of (badged JOINT by fall-through). */
const lostSenses=[], changedSrc=[];
for (const t of data.acronyms.terms) {
  const was=termsBefore.get(String(t.a||"").toUpperCase());
  if (!was) continue;
  const now=String(t.d||"").toLowerCase();
  for (const sense of was.d.split(";").map(s=>s.trim()).filter(Boolean)) if (!now.includes(sense.toLowerCase())) lostSenses.push(`${t.a}: "${sense}"`);
  if (t.src!==was.src) changedSrc.push(`${t.a}: ${was.src} -> ${t.src}`);
}
expect(lostSenses.length===0, `every meaning the seed dictionary had survives the modules (${termsBefore.size} entries checked)`, "meanings lost: "+lostSenses.join(" | "));
expect(changedSrc.length===0, "no pre-existing dictionary entry has its source tag changed", "source tags changed: "+changedSrc.slice(0,12).join(" | "));
const termOf=a=>data.acronyms.terms.find(t=>String(t.a).toUpperCase()===a)||{};
expect(/area of operations/.test(termOf("AO").d) && /authorizing official/i.test(termOf("AO").d), "AO carries both \"area of operations\" and the cybersecurity \"authorizing official\"", JSON.stringify(termOf("AO")));
expect(/air tasking order/.test(termOf("ATO").d) && /antiterrorism officer/.test(termOf("ATO").d) && /authorization to operate/i.test(termOf("ATO").d), "ATO carries \"air tasking order; antiterrorism officer\" and \"authorization to operate\"", JSON.stringify(termOf("ATO")));
const strangers=data.acronyms.terms.filter(t=>!srcVocabulary.has(t.src)).map(t=>t.a+"="+t.src);
expect(strangers.length===0, `every dictionary entry uses a source tag the seed already uses (${[...srcVocabulary].join(", ")})`, "unknown source tags: "+strangers.slice(0,12).join(", "));
const promptSeen=new Map(), promptDup=[];
for (const q of data.board.questions) { const k=String(q.q||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); if (promptSeen.has(k)) promptDup.push(`"${q.q}" (${promptSeen.get(k)} and ${q.id})`); else promptSeen.set(k,q.id); }
expect(promptDup.length===0, "no two board questions ask the identical prompt (opsec-cyber-01 used to repeat bq-opsec-02's \"What is OPSEC?\" with a different answer)", promptDup.join(" | "));

// ROADMAP 3g E: 06-opsec-cyber-curriculum.js (the runtime half) no longer
// exposes G.opsec.audit - the counts it reported are read directly off the
// merged bank instead (06-opsec-cyber-curriculum-content.js's own define()
// return value, reached by id, covers the same "did every card/term reach
// the bank" question the old audit answered).
const contentPack = merge.packs["opsec-cyber-curriculum-content"];
expect(!!contentPack && Array.isArray(contentPack.cardIds) && contentPack.cardIds.length===34, "all 34 Cybersecurity & OPSEC board questions were pushed by the content pack", `cardIds.length=${contentPack && contentPack.cardIds.length}`);
const category=data.board.questions.filter(q=>q.category==="Cybersecurity & OPSEC");
expect(contentPack.cardIds.every(id=>category.some(q=>q.id===id)), "every card the content pack pushed is represented in the canonical board bank");
expect(category.length===34, "canonical board bank contains exactly 34 Cybersecurity & OPSEC questions", `category count=${category.length}`);
const REQUIRED_TERMS=["CUI","OPSEC","RMF","ATO","AO","PII","CAC","SCIF","ISSM","ISSO","ISSE","POA&M","STIG","DISA","DLP","MFA","PKI","FOUO","CMMC","DoDIN"];
const termsPresent=REQUIRED_TERMS.filter(k=>data.acronyms.terms.some(t=>String(t.a||"").toUpperCase()===k.toUpperCase())).length;
expect(termsPresent===20, "all 20 required Cyber/OPSEC terms are represented after dedupe/update", `termsPresent=${termsPresent}`);
expect(G.opsec?.selfCheck?.length===10, "10-question local Cyber/OPSEC knowledge audit exists");
const scenarioIds=["sc-opsec-social-engineering","sc-cyber-removable-media","sc-opsec-fitness-tracking","sc-cui-spillage-reporting"];
const scs=data.scenarios?.scenarios||[];
expect(scenarioIds.every(id=>scs.some(s=>s.id===id)), "canonical Train scenario bank contains all four required scenario ids");
expect(typeof data.board.contentHash==="string" && /^[0-9a-f]{16}$/.test(data.board.contentHash), "board content hash is re-stamped after Cyber/OPSEC expansion");

const index=readFileSync(INDEX,"utf8");
const moi=readFileSync(APP+"src/app-modules/moi-import.js","utf8");
const leader=readFileSync(APP+"src/app-modules/leader.js","utf8");
const group=readFileSync(APP+"src/app-modules/studygroup.js","utf8");
expect(index.includes('{ hash: "#/cyber-opsec", label: "Cybersecurity & OPSEC"'), "#/cyber-opsec is a declared application route");
expect(/hashes:\s*\[[^\]]*"#\/cyber-opsec"/.test(index), "Cyber/OPSEC route is present in declared navigation");
expect(index.includes('"#/cyber-opsec": { d:'), "Guided Tour metadata covers the new route");
expect(moi.includes("G.opsecGuard.screen(combined)") && moi.indexOf("G.opsecGuard.screen(combined)") < moi.indexOf("runMatching(combined,") && !/screened\.text|sanitizeInput/.test(moi), "MOI import checks the text before matching, and the parser is given the ORIGINAL text - never a rewritten copy");
expect(!moi.includes("Soldier handed a real MOI"), "MOI copy no longer encourages real operational MOIs");
expect(leader.includes("G.opsecGuard.screen(") && !/sanitizeInput|decisionMessage/.test(leader) && leader.includes("Use initials, a callsign, or a roster number"), "Squad Roster checks the one free-text field and states the minimized-data rule in its own words");
expect(group.includes("Personal / explicitly authorized networks only") && group.includes("Offline-first design is not an ATO or network authorization"), "Study Rooms permanently states the official-network authorization boundary");
/* The guest join page is a second Study Rooms screen - the only one a
   participant without the app ever sees - and it carried neither the network
   boundary nor the "unofficial / not endorsed" statement, while the review
   package told a commander the Study Rooms UI "permanently states" it.
   (Template, not dist/: this gate runs without a build. tools/test-guest-page.mjs
   proves the rendered page in every room state.) */
const guest=readFileSync(APP+"src/guest.html","utf8");
expect(guest.includes("Personal / explicitly authorized networks only") && guest.includes("DoD/Army enterprise networks") && guest.includes("not an ATO or a network authorization"), "the host-served guest join page states the official-network boundary");
expect(guest.includes("Personal or explicitly authorized networks only.") && guest.includes("not endorsed by the Department of Defense, the U.S. Army, or any government agency"), "the guest page's always-drawn footer carries the boundary and the unofficial / not-endorsed statement");
const legal=readFileSync(fileURLToPath(new URL("../../GUIDON_COMMAND_LEGAL_PACKAGE.md", import.meta.url)),"utf8");
expect(/guest join page/.test(legal) && !/The Study Rooms UI permanently states/.test(legal), "the review package describes BOTH Study Rooms screens (app and guest join page) instead of claiming one UI 'permanently states' the boundary");
expect(/findings-only/.test(legal) && !/detected\/redacted locally/.test(legal) && !/hard-stopped/.test(legal) && !/blocked by the ingestion guard/.test(legal), "the review package describes the check as findings-only and no longer claims local redaction or an unqualified hard stop");
expect(/are \*\*not\*\* recognized/.test(legal) && /Unlabelled ten-digit numbers/.test(legal), "the review package states which marking shapes are recognized and what is NOT detected");
expect(legal.includes("DoDI 8510.01 — Risk Management Framework for DoD Systems"), "the review package cites DoDI 8510.01 by its current title");
/* This gate's own trigger. Its push trigger named the feature branch it was
   merged from, so after the merge it never ran on main again. */
const wf=readFileSync(fileURLToPath(new URL("../../.github/workflows/opsec-harmonization.yml", import.meta.url)),"utf8").split(/\r?\n/).filter(l=>!/^\s*#/.test(l)).join("\n");
const pushBlock=(wf.match(/\n  push:\n([\s\S]*?)(?=\n\S|\n  \S|$)/)||[])[1]||"";
expect(/^\s+branches:\s*\[\s*main\s*\]\s*$/m.test(pushBlock) && !/feature\//.test(wf), "the OPSEC Harmonization workflow runs on pushes to main (not on a merged feature branch)", JSON.stringify(pushBlock.slice(0,160)));
expect(/\n  pull_request:\n/.test(wf) && ["guidon-app/src/**","guidon-app/tools/fixtures/opsec-guard-cases.json","guidon-app/tools/seed-io.mjs","guidon-app/tools/content-pack-engine.mjs","guidon-app/tools/module-manifest.mjs","guidon-app/tools/pillar-map.mjs","GUIDON_COMMAND_LEGAL_PACKAGE.md"].every(p=>wf.split("'"+p+"'").length===3), "...and on pull requests, with every file this suite reads listed under both triggers");
expect(!readFileSync(APP+"src/app-modules/05-opsec-guard.js","utf8").match(/fetch\s*\(|XMLHttpRequest|analytics|telemetry/i), "OPSEC guard introduces no outbound network/telemetry primitive");
expect(!readFileSync(APP+"src/app-modules/06-opsec-cyber-curriculum.js","utf8").match(/fetch\s*\(|XMLHttpRequest|analytics|telemetry/i), "Cyber/OPSEC curriculum introduces no outbound network/telemetry primitive");
expect(!readFileSync(APP+"src/app-modules/06-opsec-cyber-curriculum-content.js","utf8").match(/fetch\s*\(|XMLHttpRequest|analytics|telemetry/i), "...nor does its content pack half");

console.log(`\nOPSEC curriculum totals: board=${data.board.questions.length}, scenarios=${scs.length}, acronyms=${data.acronyms?.terms?.length||0}`);
console.log(fails ? `OPSEC HARMONIZATION: ${fails} FAILURE(S)` : "OPSEC HARMONIZATION: all passed");
process.exit(fails?1:0);
