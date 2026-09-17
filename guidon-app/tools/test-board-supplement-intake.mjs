#!/usr/bin/env node
/**
 * CI gate for the user-supplied promotion-board curriculum intake.
 *
 * Executes the same pre-start app modules against the real source seed and
 * proves that every supplied source card / Q&A prompt is represented after
 * dedupe, that 92A prompts carry MOS/curriculum metadata, that the two 92A
 * judgment prompts also reach the scenario-training engine, and that the
 * final study-room content fingerprint is re-stamped after the merge.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readSeed } from "./seed-io.mjs";

const APP = fileURLToPath(new URL("../", import.meta.url));
const SEED_PATH = fileURLToPath(new URL("../src/index.html", import.meta.url));
const MODULES = [
  "src/app-modules/00-board-supplement-core.js",
  "src/app-modules/01-board-supplement-92a.js",
  "src/app-modules/02-board-supplement-integration.js",
  "src/app-modules/03-board-supplement-bankhash.js",
  "src/app-modules/04-board-supplement-92a-scenarios.js",
];

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.error("  FAIL  " + m); };
const expect = (cond, pass, fail = pass) => cond ? ok(pass) : bad(fail);

const { data } = readSeed(SEED_PATH);
const before = data.board.questions.length;
const scenariosBefore = data.scenarios?.scenarios?.length || 0;
const sandbox = { window: { GUIDON_SEED: data, G: {} }, console };
sandbox.window.window = sandbox.window;
const ctx = vm.createContext(sandbox);
for (const rel of MODULES) {
  vm.runInContext(readFileSync(APP + rel, "utf8"), ctx, { filename: rel });
}

const bank = data.board.questions;
const audit = sandbox.window.G.boardSupplement?.audit;
expect(!!audit, "runtime supplement audit exists");
expect(audit?.expectedSourceCards === 112, "audit expects all 112 supplied source cards", `expectedSourceCards=${audit?.expectedSourceCards}`);
expect(audit?.expectedQAPrompts === 224, "audit expects all 224 supplied Q&A prompts", `expectedQAPrompts=${audit?.expectedQAPrompts}`);
expect(audit?.accountedSourceCards === 112, "all 112 supplied source cards are accounted for", `accountedSourceCards=${audit?.accountedSourceCards}`);
expect(audit?.accountedQAPromptLinks === 224, "all 224 supplied Q&A prompts are accounted for after dedupe", `accountedQAPromptLinks=${audit?.accountedQAPromptLinks}`);
expect(audit?.complete === true, "supplement audit is complete");

const ids = new Set();
const dupIds = [];
for (const q of bank) {
  if (ids.has(q.id)) dupIds.push(q.id);
  ids.add(q.id);
}
expect(dupIds.length === 0, "final board bank has no duplicate ids", `duplicate ids: ${JSON.stringify(dupIds.slice(0, 8))}`);

const intake = bank.filter((q) => Array.isArray(q.sourceCards) && q.sourceCards.some((x) => /^(core72|deck40-general|deck40-92a)-/.test(x)));
const malformed = intake.filter((q) => !(q.id && q.category && q.q && q.a && q.boardAnswer && q.source && Array.isArray(q.keyPoints) && q.keyPoints.length && q.difficulty));
expect(malformed.length === 0, "every supplemented board record has the canonical study-card fields", `malformed supplemented ids: ${malformed.slice(0, 8).map((q) => q.id).join(", ")}`);

const expectedSourceIds = [];
for (let i = 1; i <= 72; i++) expectedSourceIds.push(`core72-${String(i).padStart(2, "0")}`);
for (let i = 1; i <= 20; i++) expectedSourceIds.push(`deck40-general-${String(i).padStart(2, "0")}`);
for (let i = 21; i <= 40; i++) expectedSourceIds.push(`deck40-92a-${String(i).padStart(2, "0")}`);
const represented = new Set(intake.flatMap((q) => q.sourceCards || []));
const missing = expectedSourceIds.filter((id) => !represented.has(id));
expect(missing.length === 0, "every individual supplied card has provenance in the final bank", `missing source cards: ${missing.join(", ")}`);

const mosLinks = [];
for (const q of intake) {
  const n = (q.sourceCards || []).filter((id) => /^deck40-92a-/.test(id)).length;
  for (let i = 0; i < n; i++) mosLinks.push(q);
}
expect(mosLinks.length === 40, "all 40 92A Q&A prompts are represented", `92A prompt links=${mosLinks.length}`);
const badMos = mosLinks.filter((q) => !Array.isArray(q.mos) || !q.mos.includes("92A") || !Array.isArray(q.curriculum) || !q.curriculum.includes("92A Promotion Board") || q.pillar !== "Maintenance & Supply");
expect(badMos.length === 0, "every 92A prompt is tagged for the 92A curriculum and Maintenance & Supply pillar", `bad 92A metadata: ${badMos.slice(0, 8).map((q) => q.id).join(", ")}`);

const scenarioIds = ["sc-92a-critical-part-overdue", "sc-92a-inventory-discrepancy"];
const scenarios = data.scenarios?.scenarios || [];
const addedScenarios = scenarioIds.map((id) => scenarios.find((s) => s.id === id));
expect(addedScenarios.every(Boolean), "both 92A judgment prompts are also available as interactive Train scenarios");
for (const sc of addedScenarios.filter(Boolean)) {
  const n2 = sc.nodes && sc.nodes.n2;
  const distinctEnds = n2 && Array.isArray(n2.choices) ? new Set(n2.choices.map((c) => c.goto)).size : 0;
  const shapeOk = sc.start === "n1" && sc.nodes && Object.keys(sc.nodes).length === 6 && n2 && n2.choices.length === 4 && distinctEnds === 4
    && Array.isArray(sc.mos) && sc.mos.includes("92A") && Array.isArray(sc.curriculum) && sc.curriculum.includes("92A Promotion Board")
    && sc.pillar === "Maintenance & Supply" && Array.isArray(sc.doctrine) && sc.doctrine.length > 0;
  expect(shapeOk, `${sc.id} has the normal 6-node/4-outcome scenario shape plus 92A curriculum metadata`, `${sc.id} malformed: ${JSON.stringify(sc)}`);
}
expect(scenarios.length >= scenariosBefore + 2, `scenario curriculum expands by the two supplied 92A judgment cases (${scenariosBefore} -> ${scenarios.length})`);

expect(bank.length >= before, `board bank remains additive after reconciliation (${before} -> ${bank.length})`);
expect(typeof data.board.contentHash === "string" && /^[0-9a-f]{16}$/.test(data.board.contentHash), "final supplemented bank has a 16-hex study-room content fingerprint", `contentHash=${JSON.stringify(data.board.contentHash)}`);
expect(audit?.contentHash === data.board.contentHash, "audit records the final bank fingerprint");

console.log(`\nboard supplement: ${before} base questions -> ${bank.length} final questions; ${intake.length} records carry supplied-card provenance`);
console.log(`scenario supplement: ${scenariosBefore} base scenarios -> ${scenarios.length} final scenarios`);
console.log(fails ? `BOARD SUPPLEMENT INTAKE: ${fails} FAILURE(S)` : "BOARD SUPPLEMENT INTAKE: all passed");
process.exit(fails ? 1 : 0);
