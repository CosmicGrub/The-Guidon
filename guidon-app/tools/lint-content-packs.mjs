/**
 * lint-content-packs: holds the records that src/app-modules content packs
 * add at load time to the same rules tools/lint-board-taxonomy.mjs holds the
 * static seed to - by linting the ASSEMBLED bank (tools/assemble-bank.mjs),
 * not the seed and not a list of module names.
 *
 * What the 2026-09-18 audit found the first three content waves had shipped,
 * each of which one rule below would have stopped at the PR:
 *   - six near-duplicate categories ("Land Navigation" beside the seed's
 *     "Land Navigation (TC 3-25.26)", "Army Fitness Test" beside "Army
 *     Fitness Test (AFT)" ...), splitting one subject across two names in the
 *     category picker, the quick-filter chips, the weakest-category ranking
 *     and the Readiness heatmap                                   -> rule (p4)
 *   - a hand-copied pillar table that had already drifted from
 *     tools/pillar-map.mjs                                   -> rules (p2)(p6)
 *   - the same question shipped twice under two ids                -> rule (p7)
 *   - a module with a syntax error merged to main (PR #179)        -> rule (p1)
 *   - a second "New" wave started by a pack, or a wave id that no
 *     longer exists                                              -> rule (p9)
 *
 * A pack is any src/app-modules file whose manifest.json entry says
 * "headless": true (tools/module-manifest.mjs). The contract: it must be
 * loadable with no DOM (it runs before the app boots anyway); it may extend
 * window.GUIDON_SEED and hang things off window.G.
 */
import { assembleBank } from "./assemble-bank.mjs";
import { PILLARS, PACK_CATEGORIES, pillarForBoard, pillarForDoctrine, pillarForScenario } from "./pillar-map.mjs";

const DIFFICULTIES = ["beginner", "intermediate", "expert", "advanced", "basic"];
let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const show = (arr, n = 6) => JSON.stringify(arr.slice(0, n)) + (arr.length > n ? ` (+${arr.length - n} more)` : "");

console.log("lint-content-packs: records added by src/app-modules content packs meet the same rules as the seed\n");
const r = assembleBank();
const B = r.data.board.questions, D = r.data.doctrine.entries, S = r.data.scenarios.scenarios;
const packB = B.filter((q) => q.__pack), packD = D.filter((e) => e.__pack), packS = S.filter((s) => s.__pack);
const from = (x) => `${x.id} [${x.__pack}]`;

// (p1) every headless module (manifest.json) loads with no page, cleanly.
const broken = r.modules.filter((m) => m.error);
broken.length === 0 ? ok(`(p1) all ${r.modules.length} headless modules (src/app-modules/manifest.json) load with no DOM and no error`) : bad(`(p1) module(s) failed to load headlessly: ${show(broken.map((m) => m.file + ": " + m.error), 4)}`);
const errLogs = r.logs.filter((l) => l.startsWith("error:"));
errLogs.length === 0 ? ok("(p1) no pack wrote to console.error while loading") : bad(`(p1) pack console.error output: ${show(errLogs, 3)}`);

// (p2) the finalize pass ran from the one pillar definition and had nothing to overrule.
const fin = r.G && r.G.contentPacks && r.G.contentPacks.finalized;
(fin && fin.hadMap) ? ok(`(p2) 98-content-pack-finalize ran from the injected pillar map (${fin.cards} cards fingerprinted, last)`) : bad("(p2) 98-content-pack-finalize did not run, or ran without window.GUIDON_PILLAR_MAP");
(fin && fin.corrections.length === 0)
  ? ok("(p2) no pack hand-set a pillar that tools/pillar-map.mjs disagrees with")
  : bad(`(p2) a pack's own pillar disagrees with tools/pillar-map.mjs - decide which is right, then fix the pack or add a reviewed per-id override to the map: ${show(((fin && fin.corrections) || []).map((c) => `${c.kind} ${c.id}: pack "${c.from}" vs map "${c.to}"`), 6)}`);

// (p3) ids unique across the assembled bank.
for (const [label, list] of [["board", B], ["doctrine", D], ["scenarios", S]]) {
  const seen = new Map(), dup = [];
  for (const x of list) { if (typeof x.id !== "string" || !x.id.trim()) { dup.push("(no id) " + (x.__pack || "seed")); continue; } if (seen.has(x.id)) dup.push(x.id + " [" + (x.__pack || "seed") + " vs " + (seen.get(x.id) || "seed") + "]"); seen.set(x.id, x.__pack || null); }
  dup.length === 0 ? ok(`(p3) every assembled ${label} id is present and unique (${list.length})`) : bad(`(p3) ${label} id problems: ${show(dup)}`);
}

// (p4) pack categories: an existing seed category spelled exactly, or one
//      declared in PACK_CATEGORIES - and never a near-duplicate of a seed one.
const norm = (s) => String(s).toLowerCase().replace(/[—–]/g, "-").replace(/\s*\(.*?\)\s*/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const seedCats = new Set(B.filter((q) => !q.__pack).map((q) => q.category));
const seedNorm = new Map([...seedCats].map((c) => [norm(c), c]));
const undeclared = {}, nearDup = {};
for (const q of packB) {
  if (seedCats.has(q.category)) continue;
  const twin = seedNorm.get(norm(q.category));
  if (twin) { (nearDup[q.category + "  ->  " + twin] = nearDup[q.category + "  ->  " + twin] || []).push(q.id); continue; }
  if (!(q.category in PACK_CATEGORIES)) (undeclared[q.category] = undeclared[q.category] || []).push(q.id);
}
Object.keys(nearDup).length === 0 ? ok("(p4) no pack category is a near-duplicate of a seed category") : bad(`(p4) pack categories that duplicate a seed category under another spelling - use the seed's exact name: ${JSON.stringify(Object.fromEntries(Object.entries(nearDup).map(([k, v]) => [k, v.length + " card(s)"])))}`);
Object.keys(undeclared).length === 0 ? ok(`(p4) every other pack category is a seed category or declared in PACK_CATEGORIES (${Object.keys(PACK_CATEGORIES).length} declared)`) : bad(`(p4) pack categories that are neither a seed category nor declared in tools/pillar-map.mjs PACK_CATEGORIES - if one of these is really an existing subject, use the seed's name for it: ${JSON.stringify(Object.fromEntries(Object.entries(undeclared).map(([k, v]) => [k, v.length + " card(s)"])))}`);

// (p5) the answer surface and closed vocabularies, for pack cards.
for (const f of ["q", "a", "boardAnswer", "source"]) {
  const miss = packB.filter((q) => !(typeof q[f] === "string" && q[f].trim()));
  miss.length === 0 ? ok(`(p5) every pack card has a non-empty ${f}`) : bad(`(p5) ${miss.length} pack card(s) missing ${f}: ${show(miss.map(from))}`);
}
const noKp = packB.filter((q) => !(Array.isArray(q.keyPoints) && q.keyPoints.length));
noKp.length === 0 ? ok("(p5) every pack card has keyPoints") : bad(`(p5) ${noKp.length} pack card(s) without keyPoints: ${show(noKp.map(from))}`);
const badDiff = packB.filter((q) => !DIFFICULTIES.includes(q.difficulty));
badDiff.length === 0 ? ok("(p5) every pack card's difficulty is in the closed set") : bad(`(p5) pack card(s) with an unknown difficulty: ${show(badDiff.map((q) => from(q) + "=" + q.difficulty))}`);
const fakeSrc = packB.filter((q) => /user[- ]supplied|chatgpt|todo|tbd/i.test(String(q.source)));
fakeSrc.length === 0 ? ok("(p5) no pack card cites a placeholder instead of a source") : bad(`(p5) ${fakeSrc.length} pack card(s) cite a placeholder ("user-supplied", "TBD" ...) - a Soldier sees this string on the card; cite the real publication: ${show(fakeSrc.map(from))}`);

// (p6) pillar: exactly what the map says, both directions, for pack records.
const mism = [];
for (const [label, list, fn] of [["board", packB, pillarForBoard], ["doctrine", packD, pillarForDoctrine], ["scenario", packS, pillarForScenario]]) {
  for (const x of list) { const want = fn(x); if ((want || x.pillar != null) && x.pillar !== want) mism.push(`${label} ${from(x)}: pillar=${JSON.stringify(x.pillar ?? null)} expected ${JSON.stringify(want)}`); if (x.pillar != null && !PILLARS.includes(x.pillar)) mism.push(`${label} ${from(x)}: non-canonical pillar ${JSON.stringify(x.pillar)}`); }
}
mism.length === 0 ? ok(`(p6) every pack record carries exactly the pillar tools/pillar-map.mjs names (${packB.length} cards, ${packD.length} doctrine, ${packS.length} scenarios)`) : bad(`(p6) ${mism.length} pack record(s) off the map: ${show(mism, 5)}`);

// (p7) the same question must not ship twice.
const normQ = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const byQ = new Map(); for (const q of B) { const k = normQ(q.q); (byQ.get(k) || byQ.set(k, []).get(k)).push(q); }
const dupQ = [...byQ.values()].filter((g) => g.length > 1 && g.some((q) => q.__pack));
dupQ.length === 0 ? ok("(p7) no pack card repeats a question already in the bank") : bad(`(p7) ${dupQ.length} question(s) appear more than once - reconcile into the OLDER id so study history survives: ${show(dupQ.map((g) => g.map((q) => q.id).join(" = ")), 6)}`);

// (p8) pack scenarios are structurally playable.
const brokenSc = [];
for (const s of packS) {
  const nodes = s.nodes || {};
  const ids = new Set(Object.keys(nodes));
  if (!s.start || !ids.has(s.start)) brokenSc.push(from(s) + ": start node missing");
  let ends = 0;
  for (const [nid, n] of Object.entries(nodes)) {
    if (n && n.end) ends++;
    for (const c of ((n && n.choices) || [])) if (c.goto && !ids.has(c.goto)) brokenSc.push(`${from(s)}: ${nid} -> missing node "${c.goto}"`);
  }
  if (!ends) brokenSc.push(from(s) + ": no end node");
  if (!Array.isArray(s.doctrine) || !s.doctrine.length) brokenSc.push(from(s) + ": cites no doctrine");
}
brokenSc.length === 0 ? ok(`(p8) all ${packS.length} pack scenarios have a start, reachable targets, an end and a doctrine citation`) : bad(`(p8) pack scenario problems: ${show(brokenSc, 6)}`);

// (p9) one "New" wave at a time, across the ASSEMBLED bank. lint-board-taxonomy
// (g) holds the seed to this; a pack or the finalize pass could otherwise
// start a second wave it never sees. The finalize pass also reports how many
// of its declared wave ids it actually found - a renamed or deleted scenario
// would otherwise just silently stop being "New".
const sinceVals = [...new Set([...B, ...D, ...S].map((x) => x.since).filter(Boolean))];
sinceVals.length <= 1
  ? ok(`(p9) at most one \`since\` wave is live across the assembled bank (${JSON.stringify(sinceVals)})`)
  : bad(`(p9) more than one \`since\` wave is live once the packs load - retire the older one: ${JSON.stringify(sinceVals)}`);
const nw = fin && fin.newWave;
(nw && nw.tagged === nw.expected && (!sinceVals.length || sinceVals[0] === nw.since))
  ? ok(`(p9) the finalize pass tagged all ${nw.expected} scenarios of its declared wave (${nw.since})`)
  : bad(`(p9) 98-content-pack-finalize NEW_WAVE is out of step with the bank: ${JSON.stringify(nw || null)}, live since values ${JSON.stringify(sinceVals)} - an id in the wave no longer exists, or something else already carries a different \`since\``);

console.log(`\n  assembled bank: ${B.length} cards (${packB.length} from packs), ${D.length} doctrine (${packD.length}), ${S.length} scenarios (${packS.length})`);
console.log(fails === 0 ? "\nLINT-CONTENT-PACKS: all passed" : `\nLINT-CONTENT-PACKS: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
