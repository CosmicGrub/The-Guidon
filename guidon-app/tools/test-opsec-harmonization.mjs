#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readSeed } from "./seed-io.mjs";

const APP = fileURLToPath(new URL("../", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.html", import.meta.url));
const modules = [
  "src/app-modules/00-board-supplement-core.js",
  "src/app-modules/01-board-supplement-92a.js",
  "src/app-modules/02-board-supplement-integration.js",
  "src/app-modules/03-board-supplement-bankhash.js",
  "src/app-modules/04-board-supplement-92a-scenarios.js",
  "src/app-modules/05-opsec-guard.js",
  "src/app-modules/06-opsec-cyber-curriculum.js",
];
let fails=0;
const ok=m=>console.log("  PASS  "+m);
const bad=m=>{fails++;console.error("  FAIL  "+m);};
const expect=(c,p,f=p)=>c?ok(p):bad(f);

const { data } = readSeed(INDEX);
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
for(const rel of modules) vm.runInContext(readFileSync(APP+rel,"utf8"),ctx,{filename:rel});

const guard=G.opsecGuard;
expect(!!guard && typeof G.util?.sanitizeInput === "function", "shared OPSEC sanitizer is exported through G.util and G.opsecGuard");
expect(guard.sanitizeInput("SECRET operational annex").blocked, "SECRET-marked input hard-stops");
expect(guard.sanitizeInput("CUI // SP-PRVCY").blocked, "CUI-marked input hard-stops");
const ssn=guard.sanitizeInput("SSN 123-45-6789");
expect(!ssn.blocked && ssn.text.includes("[SSN REDACTED]"), "SSN is locally redacted without pretending the document is declassified");
const uic=guard.sanitizeInput("UIC W1ABCD");
expect(uic.text.includes("[UNIT REDACTED]"), "context-labeled six-character UIC is redacted");
const dod=guard.sanitizeInput("DoD ID: 1234567890");
expect(dod.text.includes("[IDENTIFIER REDACTED]"), "context-labeled 10-digit DoD ID/EDIPI is redacted");
const agg=guard.sanitizeInput("Deployment movement on 2030-05-20 at Fort Example training area");
expect(agg.requiresReview && !agg.blocked, "future operational date + location is flagged for human removal/review");
expect(!guard.sanitizeInput("Board study session on 2026-09-17").blocked, "ordinary benign study text is not classified by the guard");

const audit=G.opsec?.audit;
expect(audit?.cardsPresent===34, "all 34 Cybersecurity & OPSEC board questions are represented", `cardsPresent=${audit?.cardsPresent}`);
expect(audit?.termsPresent===20, "all 20 required Cyber/OPSEC terms are represented after dedupe/update", `termsPresent=${audit?.termsPresent}`);
expect(audit?.scenariosPresent===4, "all four synthetic Cyber/OPSEC scenarios are in the canonical scenario bank", `scenariosPresent=${audit?.scenariosPresent}`);
expect(G.opsec?.selfCheck?.length===10, "10-question local Cyber/OPSEC knowledge audit exists");
const category=data.board.questions.filter(q=>q.category==="Cybersecurity & OPSEC");
expect(category.length===34, "canonical board bank contains exactly 34 Cybersecurity & OPSEC questions", `category count=${category.length}`);
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
expect(moi.includes("G.opsecGuard") && moi.indexOf("G.opsecGuard") < moi.indexOf("runMatching(screened.text)"), "MOI import screens source text before the matching/persistence path");
expect(!moi.includes("Soldier handed a real MOI"), "MOI copy no longer encourages real operational MOIs");
expect(leader.includes("G.opsecGuard") && leader.includes("Use initials, a callsign, or a roster number"), "Squad Roster guards identifier mutation and states the minimized-data rule");
expect(group.includes("Personal / explicitly authorized networks only") && group.includes("Offline-first design is not an ATO or network authorization"), "Study Rooms permanently states the official-network authorization boundary");
expect(!readFileSync(APP+"src/app-modules/05-opsec-guard.js","utf8").match(/fetch\s*\(|XMLHttpRequest|analytics|telemetry/i), "OPSEC guard introduces no outbound network/telemetry primitive");
expect(!readFileSync(APP+"src/app-modules/06-opsec-cyber-curriculum.js","utf8").match(/fetch\s*\(|XMLHttpRequest|analytics|telemetry/i), "Cyber/OPSEC curriculum introduces no outbound network/telemetry primitive");

console.log(`\nOPSEC curriculum totals: board=${data.board.questions.length}, scenarios=${scs.length}, acronyms=${data.acronyms?.terms?.length||0}`);
console.log(fails ? `OPSEC HARMONIZATION: ${fails} FAILURE(S)` : "OPSEC HARMONIZATION: all passed");
process.exit(fails?1:0);
