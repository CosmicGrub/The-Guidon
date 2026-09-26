/**
 * The ESP32 handheld's decks (lanes): exporter, C++ deck logic, firmware wiring.
 *
 * WHY THIS SUITE EXISTS: GUIDON hides every MOS-specific card (92A, 68W, ...)
 * until a Soldier opts in. The handheld used to ignore that: its exporter dumped
 * the whole assembled bank into one list, so a medic's or a supply clerk's cards
 * sat in every Soldier's subject list. Decks fix that - a default lane with NO
 * MOS card in it, and one lane per registered MOS deck, picked on the device -
 * but the fix only holds if all of these stay true, and none of them is visible
 * from the outside:
 *
 *   1. the exporter's default lane holds not one MOS-tagged card, each MOS lane
 *      holds exactly the cards its code tags (the registry read the app's own
 *      way), and every figure adds up to the content manifest - and when it
 *      does not, it stops and writes nothing;
 *   2. cards.ndjson and categories.json are still what older firmware reads,
 *      byte for byte, so a handheld that has not been reflashed keeps working;
 *   3. the C++ that filters subjects by deck (src/lanes.h, the same header the
 *      firmware builds) really does what the exporter's files mean - compiled
 *      and RUN here on the real export, not read;
 *   4. main.cpp is wired to it (decks off = exactly as before), and the sizes
 *      the exporter promises fit the arrays the firmware has.
 *
 * Release plumbing (the deck list as a release file, gated by version) is held
 * by test-release-pipeline.mjs and test-release-state.mjs.
 *
 * Reading the two JSON files (src/lanes_json.h, ArduinoJson) is run for real too
 * - but only where ArduinoJson is on the machine (a PlatformIO build of
 * env:flashcardos fetches it); CI's test jobs do not build the firmware, so
 * there that part prints SKIP. Not covered anywhere off the device: drawing the
 * deck button, touch, and the NVS-saved pick. The firmware itself is compiled
 * by the release workflow (env:flashcardos) and by hand
 * (python3 -m platformio run -e flashcardos); the rest needs flashing - see
 * firmware/esp32-flashcard-os/README.md, "Trying decks on the physical device".
 *
 * Pure node: no browser is launched. The C++ part needs a C++ compiler (g++,
 * clang++ or MSVC's cl); with none it is SKIPPED on a developer machine and
 * FAILS on CI (where ubuntu-latest has g++), so it can never be skipped there
 * without anyone noticing.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ok, bad, check, finish } from "./testkit.mjs";
import { assembleBank } from "./assemble-bank.mjs";
import { loadManifest, MANIFEST_PATH } from "./content-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FW = path.join(REPO, "firmware", "esp32-flashcard-os");
const EXPORTER = path.join(FW, "tools", "extract-cards.mjs");
const lanesMod = await import(pathToFileURL(path.join(FW, "tools", "lanes.mjs")).href);
const { buildExport, laneMismatches, allMismatches, deviceLabel, laneIdsOfCard, mosRegistry, LIMITS, DEFAULT_LANE_ID, DEFAULT_LANE_LABEL, lanesJson } = lanesMod;

const scratch = mkdtempSync(path.join(tmpdir(), "guidon-esp32-lanes-"));
const exp = (...args) => spawnSync(process.execPath, [EXPORTER, ...args], { encoding: "utf8", cwd: scratch });
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  const assembled = assembleBank();
  const bank = assembled.data;
  const cards = bank.board.questions;
  const manifest = loadManifest();
  const isMos = (q) => Array.isArray(q.mos) && q.mos.length > 0;
  const mosCards = cards.filter(isMos);
  const codeOf = (raw) => String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // The registry as the seed states it - read here without the exporter's own code path.
  const seedDecks = bank.mosDecks.map((d) => ({ code: codeOf(d.code), label: String(d.label || d.code) })).sort((a, b) => byCodeUnit(a.label, b.label));

  /* ================================================================ 1. the real export */
  console.log("1. The real bank, exported");
  const OUT = path.join(scratch, "sdcard");
  const run1 = exp("--out", OUT);
  check(run1.status === 0 && ["cards.ndjson", "categories.json", "lanes.json"].every((f) => existsSync(path.join(OUT, f))), "the exporter writes cards.ndjson, categories.json AND lanes.json", "export: exit " + run1.status + "\n" + run1.stdout + run1.stderr);
  const ndjson = readFileSync(path.join(OUT, "cards.ndjson"), "utf8");
  const categories = readJson(path.join(OUT, "categories.json"));
  const lanesFile = readJson(path.join(OUT, "lanes.json"));
  const lines = ndjson.split("\n").filter(Boolean);
  const laneOf = (id) => lanesFile.lanes.find((l) => l.id === id);
  // The card lines each lane's subjects cover, read back from the written files the way the device
  // would find them: seek to the subject's byte offset, take `count` lines.
  const lineAtOffset = new Map();
  { let at = 0; lines.forEach((l, i) => { lineAtOffset.set(at, i); at += Buffer.byteLength(l, "utf8") + 1; }); }
  const linesOfLane = (id) => {
    const out = [];
    for (const c of categories) {
      if (!c.lanes.includes(id)) continue;
      const idx = lineAtOffset.get(c.offset);
      for (let k = 0; k < c.count; k++) out.push(JSON.parse(lines[idx + k]));
    }
    return out;
  };

  /* ---- 2. what older firmware reads is unchanged ------------------------------ */
  // The exporter exactly as it was before decks existed (verbatim grouping), run over the same bank.
  const order = [], byCat = new Map();
  for (const q of cards) { const cat = q.category || "(uncategorized)"; if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat); } byCat.get(cat).push(q); }
  let oldNdjson = ""; const oldCategories = [];
  for (const cat of order) {
    const offset = Buffer.byteLength(oldNdjson, "utf8");
    for (const q of byCat.get(cat)) oldNdjson += JSON.stringify({ i: q.id, c: cat, q: q.q, a: q.boardAnswer || q.a }) + "\n";
    oldCategories.push({ name: cat, count: byCat.get(cat).length, offset });
  }
  check(ndjson === oldNdjson, "cards.ndjson is byte for byte what the exporter wrote before decks existed - every card, MOS ones included, in the same order", "cards.ndjson differs from the pre-decks export");
  check(same(categories.map(({ lanes, ...rest }) => rest), oldCategories), "categories.json is the same list as before (name, count, offset, in order); each entry only GAINS a \"lanes\" list, so older firmware ignores it", "categories.json changed beyond the added lanes field");
  check(categories.every((c) => typeof c.name === "string" && Number.isInteger(c.count) && Number.isInteger(c.offset) && Array.isArray(c.lanes) && c.lanes.length > 0), "every subject has a name, a count, an offset and at least one lane");
  {
    // What the previous firmware does with a subject: seek to its offset, read `count` lines, all in that category.
    const bytes = Buffer.from(ndjson, "utf8");
    let all = true, total = 0;
    for (const c of categories) {
      const chunk = bytes.subarray(c.offset).toString("utf8").split("\n").slice(0, c.count);
      all = all && chunk.length === c.count && chunk.every((l) => JSON.parse(l).c === c.name);
      total += c.count;
    }
    check(all && total === lines.length, "seeking to each subject's offset and reading its count of lines lands on that subject's cards (what the older firmware does), for every subject");
  }
  const again = exp("--out", path.join(scratch, "sdcard-again"));
  check(again.status === 0 && ["cards.ndjson", "categories.json", "lanes.json"].every((f) => readFileSync(path.join(scratch, "sdcard-again", f), "utf8") === readFileSync(path.join(OUT, f), "utf8")), "exporting twice writes identical files (nothing in them depends on the clock or the run)");

  /* ---- 3. lanes.json against the registry and the manifest -------------------- */
  console.log("\n2. lanes.json: the default lane, and one lane per registered MOS deck");
  check(lanesFile.schema === 1 && Array.isArray(lanesFile.lanes) && lanesFile.lanes[0].id === DEFAULT_LANE_ID && lanesFile.lanes[0].label === DEFAULT_LANE_LABEL, "lanes.json says schema 1 and lists the default lane (\"Standard deck\") first");
  const decksWithCards = seedDecks.filter((d) => mosCards.some((q) => q.mos.some((m) => codeOf(m) === d.code)));
  check(same(lanesFile.lanes.slice(1).map((l) => l.id), decksWithCards.map((d) => d.code)) && decksWithCards.length > 0,
    `each registered MOS deck is its own lane, in the app's own order (${decksWithCards.map((d) => d.code).join(", ")})`, "MOS lanes " + JSON.stringify(lanesFile.lanes.slice(1).map((l) => l.id)) + " do not match the registry " + JSON.stringify(decksWithCards.map((d) => d.code)));
  const untagged = cards.filter((q) => !isMos(q));
  const defaultLines = linesOfLane(DEFAULT_LANE_ID);
  const mosIds = new Set(mosCards.map((q) => q.id));
  check(defaultLines.every((l) => !mosIds.has(l.i)), "the DEFAULT lane holds not one MOS-tagged card (the opt-in rule), read back from the written files", "an MOS card is in the default lane: " + (defaultLines.find((l) => mosIds.has(l.i)) || {}).i);
  check(same(defaultLines.map((l) => l.i).sort(), untagged.map((q) => q.id).sort()) && laneOf(DEFAULT_LANE_ID).count === untagged.length, "...and holds every card that has no MOS tag, and only those");
  check(!categories.some((c) => c.lanes.includes(DEFAULT_LANE_ID) && c.lanes.length > 1) && categories.filter((c) => !c.lanes.includes(DEFAULT_LANE_ID)).every((c) => c.lanes.every((id) => decksWithCards.some((d) => d.code === id))), "no subject is in the default lane AND an MOS lane, and an MOS subject is in MOS lanes only");
  for (const d of decksWithCards) {
    const lane = laneOf(d.code);
    const tagged = mosCards.filter((q) => q.mos.some((m) => codeOf(m) === d.code));
    check(same(linesOfLane(d.code).map((l) => l.i).sort(), tagged.map((q) => q.id).sort()), `${d.code}: the lane holds exactly the cards tagged ${d.code}, no more and no fewer`);
    check(lane.count === manifest.board.byMos[d.code], `${d.code}: the lane's count is the content manifest's figure for that deck`, `${d.code}: lane says ${lane.count}, manifest says ${manifest.board.byMos[d.code]}`);
    check(lane.label.startsWith(d.code) && /^[\x20-\x7E]+$/.test(lane.label) && lane.label.length <= LIMITS.laneLabel, `${d.code}: its label ("${lane.label}") starts with the code, is plain ASCII and fits the deck button`);
    check(same(lane.categories, categories.filter((c) => c.lanes.includes(d.code)).map((c) => c.name)), `${d.code}: the subject names in lanes.json are the subjects categories.json puts in that lane`);
  }
  check(laneOf(DEFAULT_LANE_ID).count + mosCards.length === manifest.totals.board, "the default lane plus every MOS card is the manifest's whole deck (nothing lost, nothing counted twice)");
  check(lanesFile.lanes.reduce((n, l) => n + l.categories.length, 0) === categories.reduce((n, c) => n + c.lanes.length, 0), "lanes.json lists each subject once for every lane it is in");

  /* ---- 4. the manifest cross-check fails closed -------------------------------- */
  console.log("\n3. When the lanes do not add up to the content manifest, the exporter stops and writes nothing");
  const planted = (mutate, name) => {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    mutate(m);
    const file = path.join(scratch, name + ".json");
    writeFileSync(file, JSON.stringify(m, null, 2) + "\n", "utf8");
    const out = path.join(scratch, "out-" + name);
    const r = exp("--out", out, "--manifest", file);
    return { r, out, gone: !existsSync(out) };
  };
  const firstMos = decksWithCards[0].code;
  let p = planted((m) => { m.board.byMos[firstMos] += 1; }, "mos-plus-one");
  check(p.r.status !== 0 && /NOTHING WAS WRITTEN/.test(p.r.stderr) && new RegExp("MOS deck " + firstMos + ": its lane holds").test(p.r.stderr) && p.gone, `the manifest says ${firstMos} has one card more than its lane holds: stopped, the deck named, nothing written`, "planted +1 on " + firstMos + ": exit " + p.r.status + " folderGone=" + p.gone + "\n" + p.r.stderr.slice(0, 500));
  p = planted((m) => { delete m.board.byMos[firstMos]; }, "mos-missing");
  check(p.r.status !== 0 && new RegExp("MOS deck " + firstMos).test(p.r.stderr) && p.gone, "a registered deck the manifest has no figure for is a mismatch too, not a pass");
  p = planted((m) => { m.board.byMos.NOSUCH = 3; }, "mos-extra");
  check(p.r.status !== 0 && /MOS deck NOSUCH/.test(p.r.stderr) && p.gone, "the manifest naming a deck the bank has no lane for is a mismatch");
  const mosCategory = categories.find((c) => !c.lanes.includes(DEFAULT_LANE_ID)).name;
  p = planted((m) => { m.board.byCategory[mosCategory] += 1; m.totals.board += 1; }, "cat-plus-one");
  check(p.r.status !== 0 && p.r.stderr.includes('category "' + mosCategory + '"') && p.gone, "one card short in an MOS subject: stopped, the subject named, nothing written");
  p = planted((m) => { m.totals.board += 1; }, "total-plus-one");
  check(p.r.status !== 0 && /the default lane \(\d+\) plus the MOS-only cards/.test(p.r.stderr) && p.gone, "a total that no longer equals the default lane plus the MOS-only cards is caught by the lane arithmetic as well as the total check");

  /* ---- 5. the pure exporter, on stand-in banks --------------------------------- */
  console.log("\n4. Grouping into subjects and lanes, on small stand-in banks");
  const registry = { decks: [{ code: "68W", label: "68W Medic", pillar: null }, { code: "92A", label: "92A Supply", pillar: null }], normalize: codeOf };
  const C = (id, category, extra = {}) => ({ id, category, q: "q " + id, a: "a " + id, ...extra });
  const manifestOf = (bankCards) => {
    const byCategory = {}, byMos = {};
    for (const q of bankCards) { const c = q.category || "(uncategorized)"; byCategory[c] = (byCategory[c] || 0) + 1; for (const m of (q.mos || [])) byMos[String(m).toUpperCase()] = (byMos[String(m).toUpperCase()] || 0) + 1; }
    return { fingerprint: "fp", totals: { board: bankCards.length }, board: { byCategory, byMos } };
  };
  const mixed = [C("a1", "Army Values"), C("a2", "Army Values"), C("m1", "68W - Basics", { mos: ["68W"] }), C("s1", "Shared"), C("s2", "Shared", { mos: ["92A"] }), C("b1", "Both", { mos: ["68W", "92A"] }), C("a3", "Army Values")];
  const built = buildExport(mixed, registry);
  check(built.problems.length === 0 && same(built.categories.map((c) => [c.name, c.count, c.lanes]), [["Army Values", 3, ["default"]], ["68W - Basics", 1, ["68W"]], ["Shared", 1, ["default"]], ["Shared", 1, ["92A"]], ["Both", 1, ["68W", "92A"]]]),
    "a category that mixes lanes is split into one subject per lane; a card tagged for two decks is one subject listed in both", "subjects: " + JSON.stringify(built.categories));
  check(same(built.lanes.map((l) => [l.id, l.count, l.categories]), [["default", 4, ["Army Values", "Shared"]], ["68W", 2, ["68W - Basics", "Both"]], ["92A", 2, ["Shared", "Both"]]]),
    "...so the default lane gets the shared subject's untagged card and the 92A lane gets its tagged one", "lanes: " + JSON.stringify(built.lanes));
  check(built.ndjson.split("\n").filter(Boolean).length === mixed.length && new Set(built.ndjson.split("\n").filter(Boolean).map((l) => JSON.parse(l).i)).size === mixed.length, "every card is written exactly once, even the one two decks share");
  check(same(allMismatches(built, mixed, registry, "fp", manifestOf(mixed)), []), "the whole set of checks passes on that export (manifest, offsets, lanes)", "checks: " + JSON.stringify(allMismatches(built, mixed, registry, "fp", manifestOf(mixed))));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const expectProblem = (label, tamper, pattern) => {
    const t = clone({ ndjson: built.ndjson, categories: built.categories, lanes: built.lanes });
    const man = manifestOf(mixed);
    tamper(t, man);
    const found = laneMismatches(t, mixed, registry, man).concat(lanesMod.exportMismatches(t.ndjson, t.categories, "fp", man));
    check(found.some((m) => pattern.test(m)), label, label + " was NOT caught: " + JSON.stringify(found));
  };
  expectProblem("an MOS card slipped into the default lane is caught", (t) => { t.categories[4].lanes.push("default"); }, /default lane holds an MOS-tagged card/);
  expectProblem("an MOS subject listed in no lane is caught", (t) => { t.categories[1].lanes = []; }, /is in no lane/);
  expectProblem("a subject whose offset is off (the device would seek to the wrong card) is caught", (t) => { t.categories[2].offset += 1; }, /starts at byte/);
  expectProblem("a lane count that does not match its subjects is caught", (t) => { t.lanes[1].count += 1; }, /lanes\.json says/);
  expectProblem("subject names in lanes.json that differ from categories.json are caught", (t) => { t.lanes[2].categories = ["Shared"]; }, /subject names in lanes\.json/);
  expectProblem("an MOS lane with a card missing is caught against the bank's own tags", (t) => { t.categories[3].lanes = ["68W"]; }, /lane "92A"/);
  expectProblem("the default lane listed second is caught", (t) => { t.lanes.reverse(); }, /default lane first/);
  expectProblem("a manifest that disagrees about an MOS deck is caught", (t, man) => { man.board.byMos["92A"] += 1; }, /MOS deck 92A/);
  expectProblem("a manifest total that disagrees is caught", (t, man) => { man.totals.board += 1; }, /content manifest says/);
  const unknown = buildExport([C("z1", "Army Values"), C("z2", "Army Values", { mos: ["ZZZ"] })], registry);
  check(unknown.problems.length > 0 && /card z2/.test(unknown.problems[0]) && /"ZZZ"/.test(unknown.problems[0]) && /no MOS deck with that code is registered/.test(unknown.problems[0]), "a card tagged for a deck nobody registered stops the export, naming the card and the tag (the app would hide it from everyone)", "unknown tag: " + JSON.stringify(unknown.problems));
  const spelled = buildExport([C("x1", "Supply", { mos: ["92-a"] }), C("x2", "Army Values")], registry);
  check(same(spelled.categories.map((c) => c.lanes), [["92A"], ["default"]]), "a tag spelled \"92-a\" lands in the 92A lane, not the default one (codes are normalised the way the app normalises them)");
  const unused = buildExport([C("u1", "Army Values")], { decks: [...registry.decks, { code: "11B", label: "11B Infantry" }], normalize: codeOf });
  check(same(unused.lanes.map((l) => l.id), ["default"]), "a registered deck with no cards is not offered as an empty lane");
  const noneAtAll = buildExport([C("n1", "A"), C("n2", "B")], registry);
  check(same(noneAtAll.lanes.map((l) => l.id), ["default"]) && same(noneAtAll.categories.map((c) => c.lanes), [["default"], ["default"]]), "a bank with no MOS cards has just the default lane (every subject, as before)");
  const manyDecks = { decks: Array.from({ length: LIMITS.lanes }, (_, i) => ({ code: "D" + String(i).padStart(2, "0"), label: "Deck " + i })), normalize: codeOf };
  const manyCards = manyDecks.decks.map((d, i) => C("k" + i, "Cat " + i, { mos: [d.code] })).concat([C("k-def", "Army Values")]);
  const tooMany = buildExport(manyCards, manyDecks);
  check(tooMany.problems.some((m) => new RegExp("at most " + LIMITS.lanes).test(m) && /decks/.test(m)), "more decks than the handheld can hold stops the export, saying so");
  const longCode = buildExport([C("l1", "Long", { mos: ["ABCDEFGHIJKL"] })], { decks: [{ code: "ABCDEFGHIJKL", label: "Long" }], normalize: codeOf });
  check(longCode.problems.some((m) => /ABCDEFGHIJKL/.test(m) && /characters/.test(m)), "a deck code longer than the handheld can hold stops the export");
  const manyCats = buildExport(Array.from({ length: LIMITS.categories + 1 }, (_, i) => C("c" + i, "Category " + i)), { decks: [], normalize: codeOf });
  check(manyCats.problems.some((m) => new RegExp("at most " + LIMITS.categories).test(m) && /subjects/.test(m)), "more subjects than the handheld has room for stops the export, instead of the rest silently not appearing");
  check(deviceLabel("68W Combat Medic Specialist (Health Care Specialist)", "68W") === "68W Combat Medic Specialist", "a long label loses its trailing parenthesis so it fits the button");
  check(deviceLabel("92A — Supply “clerk”", "92A") === '92A - Supply "clerk"' && deviceLabel("éé", "92A") === "92A" && deviceLabel("", "11B") === "11B", "dashes and quotes become plain ASCII; a label with nothing drawable falls back to the code");
  const cut = deviceLabel("A very long deck name that keeps going well past what one line of the small screen can hold", "X");
  check(cut.length <= LIMITS.laneLabel && cut.endsWith("...") && !/\s\.\.\.$/.test(cut), "a label that is still too long is cut at a word and ends in ...", "cut label: " + cut);

  /* ---- 6. the registry is read the app's own way ------------------------------- */
  const reg = mosRegistry(bank);
  check(same(reg.decks.map((d) => d.code), seedDecks.map((d) => d.code)) && reg.normalize("92-a") === "92A" && reg.normalize(" 68w ") === "68W", "the exporter reads the MOS registry by running the app's own 00-mos-decks-core.js: same decks, same order, same code normalising", "registry: " + JSON.stringify(reg.decks));
  check(same(laneIdsOfCard({ mos: ["68w", "92a"] }, reg).ids, ["68W", "92A"]) && same(laneIdsOfCard({}, reg).ids, ["default"]) && same(laneIdsOfCard({ mos: [] }, reg).ids, ["default"]), "a card with no MOS tag (or an empty list) belongs to the default lane, a two-deck card to both");
  const emptyModules = path.join(scratch, "no-mos-core");
  mkdirSync(emptyModules);
  writeFileSync(path.join(emptyModules, "manifest.json"), JSON.stringify({ modules: [] }));
  let threw = "";
  try { mosRegistry(bank, emptyModules); } catch (e) { threw = String(e.message || e); }
  check(/no 'mos-decks-core' module/.test(threw), "if the app's MOS core cannot be found the exporter refuses instead of guessing which decks exist");

  /* ================================================================ 7. firmware sizes and wiring */
  console.log("\n5. The firmware's sizes and wiring");
  const header = readFileSync(path.join(FW, "src", "lanes.h"), "utf8");
  const mainCpp = readFileSync(path.join(FW, "src", "main.cpp"), "utf8");
  const define = (name) => Number((new RegExp("#define\\s+" + name + "\\s+(\\d+)").exec(header) || [])[1]);
  const maxCategories = Number((/static const int MAX_CATEGORIES\s*=\s*(\d+);/.exec(mainCpp) || [])[1]);
  check(LIMITS.lanes === define("LANES_MAX") && LIMITS.laneId === define("LANE_ID_LEN") - 1 && LIMITS.laneLabel < define("LANE_LABEL_LEN") && LIMITS.categories === maxCategories,
    "the exporter's limits (decks, id and label length, subjects) are the firmware's array sizes (lanes.h and MAX_CATEGORIES in main.cpp)", "limits " + JSON.stringify(LIMITS) + " vs firmware " + JSON.stringify({ LANES_MAX: define("LANES_MAX"), LANE_ID_LEN: define("LANE_ID_LEN"), LANE_LABEL_LEN: define("LANE_LABEL_LEN"), MAX_CATEGORIES: maxCategories }));
  check(lanesFile.lanes.length <= define("LANES_MAX") && categories.length <= maxCategories && lanesFile.lanes.every((l) => l.id.length < define("LANE_ID_LEN") && l.label.length < define("LANE_LABEL_LEN")), "the real export fits the device: decks, subjects, deck ids and labels are all within the firmware's arrays");
  check(Buffer.byteLength(JSON.stringify(lanesFile), "utf8") < 16 * 1024, "lanes.json is small (under 16 KB); the device reads only each deck's id, label and count from it");
  check(/#include "lanes\.h"/.test(mainCpp) && /"\/lanes\.json"/.test(mainCpp) && /laneActive\(&laneTable, categoriesTagged\)/.test(mainCpp) && /laneResolve\(&laneTable, saved\)/.test(mainCpp) && /prefs\.putString\("lane"/.test(mainCpp) && /prefs\.getString\("lane"/.test(mainCpp),
    "main.cpp reads /lanes.json, switches decks on only through laneActive(), starts on the saved deck through laneResolve() and saves the pick in NVS");
  const jsonHeader = readFileSync(path.join(FW, "src", "lanes_json.h"), "utf8");
  check(/DeserializationOption::Filter/.test(jsonHeader) && /filter\["lanes"\]\[0\]\["id"\]/.test(jsonHeader) && !/\["categories"\]/.test(jsonHeader.slice(jsonHeader.indexOf("JsonDocument filter"), jsonHeader.indexOf("JsonDocument doc"))),
    "lanes.json is read through an ArduinoJson filter that keeps only id, label and count, so the per-deck subject lists are dropped as they stream past");
  check(/lanesReadTable\(f, &laneTable, &why\)/.test(mainCpp) && /lanesReadMask\(c, &laneTable, &categoriesTagged\)/.test(mainCpp) && !/deserializeJson\(doc, f, DeserializationOption/.test(mainCpp), "main.cpp reads both deck files through lanes_json.h - the code the ArduinoJson host test runs - not a copy of it");
  const subjects = mainCpp.slice(mainCpp.indexOf("static void drawSubjects()"), mainCpp.indexOf("// Screen: card view"));
  check(/visibleCat\[i\]/.test(subjects) && !/categories\[i\]/.test(subjects) && !/i < categoryCount/.test(subjects), "the subject list draws and opens subjects through the visible-subject list, never straight from every category");
  check(/lanesActive && hit\(x, y, 12, deckBtnY\(\)/.test(mainCpp) && /if \(lanesActive\) \{\s*drawDeckButton/.test(mainCpp), "the deck button exists only while decks are on (decks off: the Settings screen is what it always was)");
  check((mainCpp.match(/hit\(x, y, 12, rowY, 50, 36\)/g) || []).length === 1 && /int settingsTopY\(\) \{ return lanesActive \? HEADER_H \+ 4 : HEADER_H \+ 16; \}/.test(mainCpp), "with decks off the Settings screen keeps its original geometry (title at HEADER_H + 16); only the tighter packing is used when the deck button is drawn");
  check(existsSync(path.join(FW, "host-test", "lanes_test.cpp")) && /"sdcard\/lanes\.json"/.test(readFileSync(path.join(FW, "tools", "push-to-sd.py"), "utf8")), "the SD push tool sends lanes.json with the other card files");

  /* ================================================================ 8. the C++ deck logic, compiled and run */
  console.log("\n6. src/lanes.h, compiled and run on this machine");
  const cxxDir = path.join(scratch, "cxx");
  mkdirSync(cxxDir);
  const src = path.join(FW, "host-test", "lanes_test.cpp");
  const exe = path.join(cxxDir, process.platform === "win32" ? "lanes_test.exe" : "lanes_test");
  const compiled = compileHost(src, exe, cxxDir);
  if (compiled.error) {
    if (process.env.CI) bad("no C++ compiler found on CI, so the deck logic was not run: " + compiled.error);
    else console.log("  SKIP  the C++ deck logic was not run: " + compiled.error + " (install g++, clang++ or the Visual Studio Build Tools to run it; CI has g++)");
  } else if (!compiled.ok) {
    bad("src/lanes.h + host-test/lanes_test.cpp did not compile with " + compiled.used + ":\n" + compiled.output.slice(0, 1500));
  } else {
    ok(`host-test/lanes_test.cpp compiled against the firmware's own src/lanes.h (${compiled.used})`);
    const unit = spawnSync(exe, [], { encoding: "utf8" });
    const unitFails = (unit.stdout.match(/^ {2}FAIL /gm) || []).length;
    check(unit.status === 0 && unitFails === 0 && /LANES C\+\+ TEST: all passed/.test(unit.stdout), `the C++ deck logic passes its own checks (${(unit.stdout.match(/^ {2}PASS /gm) || []).length} of them: the table, choosing and cycling decks, the subject filter, decks-off)`, "C++ unit checks:\n" + unit.stdout.slice(-1500) + unit.stderr);

    const replay = (name, laneRows, catRows, saved) => {
      const file = path.join(cxxDir, name + ".tsv");
      const rows = [...laneRows.map((l) => ["LANE", l.id, l.label, l.count].join("\t")), ...catRows.map((c) => ["CAT", c.name, c.count, c.lanes ? c.lanes.join(",") : "-"].join("\t"))];
      if (saved !== undefined) rows.push("SAVED\t" + saved);
      writeFileSync(file, rows.join("\n") + "\n", "utf8");
      const r = spawnSync(exe, [file], { encoding: "utf8" });
      // (a Windows build prints \r\n)
      const at = (tag) => r.stdout.split(/\r?\n/).filter((l) => l.startsWith("@" + tag + "\t")).map((l) => l.split("\t").slice(1));
      return { r, active: (at("ACTIVE")[0] || [])[0], start: (at("START")[0] || [])[0], views: at("VIEW"), cycle: (at("CYCLE")[0] || [])[0], ran: r.status === 0 };
    };
    const lanesIn = lanesFile.lanes;
    const real = replay("real", lanesIn, categories);
    check(real.ran && real.active === "1", "replaying the real export through the device's own logic: decks are on");
    check(real.start === DEFAULT_LANE_ID, "with nothing saved the device starts on the default lane");
    check(real.views.length === lanesIn.length && lanesIn.every((l, i) => {
      const v = real.views[i];
      return v[0] === l.id && Number(v[1]) === l.categories.length && Number(v[2]) === l.count && v[3] === l.categories.join("|");
    }), "for every deck the device lists exactly the subjects lanes.json names for it - same subjects, same order, same card count", "device views: " + JSON.stringify(real.views.map((v) => v.slice(0, 3))));
    const mosSubjectNames = new Set(categories.filter((c) => !c.lanes.includes(DEFAULT_LANE_ID)).map((c) => c.name));
    const defaultView = (real.views.find((v) => v[0] === DEFAULT_LANE_ID) || [])[3] || "";
    check(defaultView.length > 0 && defaultView.split("|").every((n) => !mosSubjectNames.has(n)), "the device's default deck lists no MOS subject at all - the opt-in rule, checked on what the device would draw");
    check(real.cycle === lanesIn.map((l) => l.id).join(","), "tapping the deck button walks the decks in lanes.json's order and returns to the start");
    const saved = replay("saved", lanesIn, categories, decksWithCards[0].code);
    check(saved.start === decksWithCards[0].code, `a saved pick (${decksWithCards[0].code}) is the deck the device starts on the next time`);
    const gone = replay("gone", lanesIn, categories, "GONE");
    check(gone.start === DEFAULT_LANE_ID, "a saved deck the card no longer has puts the device back on the default lane - never on an MOS one");
    const noLanesFile = replay("no-lanes", [], categories);
    check(noLanesFile.active === "0" && noLanesFile.views.length === 1 && Number(noLanesFile.views[0][1]) === categories.length && noLanesFile.views[0][3] === categories.map((c) => c.name).join("|"), "with no lanes.json the device lists every subject in the old order, exactly as it always did", "no-lanes view: " + JSON.stringify(noLanesFile.views.map((v) => v.slice(0, 3))));
    const oldCategories = replay("old-categories", lanesIn, categories.map(({ lanes, ...rest }) => rest));
    check(oldCategories.active === "0" && Number(oldCategories.views[0][1]) === categories.length, "a lanes.json copied next to a categories.json from before decks existed leaves decks off (every subject), not an empty screen");
    const mismatched = replay("mismatch", lanesIn.filter((l) => l.id === DEFAULT_LANE_ID), categories);
    const mv = mismatched.views.find((v) => v[0] === DEFAULT_LANE_ID) || [];
    check(mismatched.active === "1" && mv[3] && mv[3].split("|").every((n) => !mosSubjectNames.has(n)), "a lanes.json that lacks an MOS deck its categories.json mentions hides that deck's subjects; it never shows them in the default deck");

    /* ---- the JSON reading, with the real ArduinoJson --------------------------- */
    // src/lanes_json.h is what main.cpp reads the two files with. It needs ArduinoJson, which a PlatformIO build
    // fetches into .pio/libdeps; CI's test jobs do not build the firmware, so there this part says it was skipped.
    console.log("\n7. src/lanes_json.h (how the device reads the two files), against the real ArduinoJson");
    const jsonLib = [process.env.ARDUINOJSON_DIR, path.join(FW, ".pio", "libdeps", "flashcardos", "ArduinoJson", "src")].filter(Boolean).find((d) => existsSync(path.join(d, "ArduinoJson.h")));
    if (!jsonLib) console.log("  SKIP  ArduinoJson is not on this machine (a PlatformIO build of env:flashcardos fetches it into firmware/esp32-flashcard-os/.pio/libdeps, or set ARDUINOJSON_DIR), so the JSON reading was not run");
    else {
      const jexe = path.join(cxxDir, process.platform === "win32" ? "lanes_json_test.exe" : "lanes_json_test");
      const jc = compileHost(path.join(FW, "host-test", "lanes_json_test.cpp"), jexe, cxxDir, [jsonLib]);
      if (jc.error || !jc.ok) bad("host-test/lanes_json_test.cpp did not build: " + (jc.error || jc.output.slice(0, 1500)));
      else {
        ok(`host-test/lanes_json_test.cpp compiled against src/lanes_json.h and ArduinoJson (${jc.used})`);
        const files = [path.join(OUT, "lanes.json"), path.join(OUT, "categories.json")];
        const j = spawnSync(jexe, files, { encoding: "utf8" });
        check(j.status === 0 && !/^ {2}FAIL /m.test(j.stdout) && /LANES JSON C\+\+ TEST: all passed/.test(j.stdout), `the JSON reading passes its own checks (${(j.stdout.match(/^ {2}PASS /gm) || []).length} of them: a good file, a cut-off one, junk fields, too many decks, a subject's deck list)`, "JSON checks:\n" + j.stdout.slice(-1500) + j.stderr);
        const at = (tag) => j.stdout.split(/\r?\n/).filter((l) => l.startsWith("@" + tag + "\t")).map((l) => l.split("\t").slice(1));
        const views = at("VIEW"), laneRows = at("LANE");
        check((at("ACTIVE")[0] || [])[0] === "1" && views.length === lanesFile.lanes.length && lanesFile.lanes.every((l, i) => views[i][0] === l.id && views[i][3] === l.categories.join("|") && Number(views[i][2]) === l.count),
          "the exporter's two real files, read the way the device reads them, give every deck exactly the subjects and card count lanes.json states", "device reading: " + JSON.stringify(views.map((v) => v.slice(0, 3))));
        check(laneRows.length === lanesFile.lanes.length && lanesFile.lanes.every((l, i) => laneRows[i][0] === l.id && laneRows[i][1] === l.label && Number(laneRows[i][2]) === l.count), "...and each deck's id, label and card count come through the filter intact");
      }
    }
  }
} catch (e) {
  bad("suite crashed: " + (e && e.stack ? e.stack : e));
} finally {
  try { rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* a temp folder the OS will reap */ }
}

/* ---------------------------------------------------------------------
   Compile host-test/lanes_test.cpp with whatever C++ compiler is here:
   $CXX, c++, g++, clang++ - then MSVC's cl (on PATH, or found through the
   Visual Studio Build Tools' own vcvars64.bat). Returns { error } when there
   is no compiler at all, { ok:false, output } when one exists and the
   compile fails (a real failure), { ok:true, used } otherwise. C++11.
   --------------------------------------------------------------------- */
function compileHost(source, exe, dir, includes = []) {
  const missing = (r) => !!r.error && (r.error.code === "ENOENT" || r.error.code === "EACCES");
  for (const cc of [process.env.CXX, "c++", "g++", "clang++"].filter(Boolean)) {
    const r = spawnSync(cc, ["-std=c++11", "-Wall", "-Wextra", ...includes.map((d) => "-I" + d), "-o", exe, source], { encoding: "utf8" });
    if (missing(r)) continue;
    return { ok: r.status === 0 && existsSync(exe), used: cc, output: (r.stdout || "") + (r.stderr || "") };
  }
  if (process.platform === "win32") {
    // Run from `dir` so cl's .obj lands there and not beside the source.
    const msvcArgs = ["/nologo", "/EHsc", "/W4", ...includes.map((d) => "/I" + d), "/Fe" + exe, source];
    let r = spawnSync("cl", msvcArgs, { encoding: "utf8", cwd: dir });
    if (!missing(r)) return { ok: r.status === 0 && existsSync(exe), used: "MSVC cl", output: (r.stdout || "") + (r.stderr || "") };
    const bat = findVcvars();
    if (bat) {
      const cmdFile = path.join(dir, "build.cmd");
      writeFileSync(cmdFile, `@echo off\r\ncall "${bat}" >nul 2>&1\r\ncl ${msvcArgs.map((a) => `"${a}"`).join(" ")}\r\n`);
      r = spawnSync("cmd.exe", ["/d", "/c", cmdFile], { encoding: "utf8", cwd: dir });
      return { ok: r.status === 0 && existsSync(exe), used: "MSVC cl (Visual Studio Build Tools)", output: (r.stdout || "") + (r.stderr || "") };
    }
  }
  return { error: "no C++ compiler found (tried $CXX, c++, g++, clang++" + (process.platform === "win32" ? ", cl and the Visual Studio Build Tools" : "") + ")" };
}
function findVcvars() {
  for (const root of [process.env["ProgramFiles(x86)"], process.env.ProgramFiles].filter(Boolean)) {
    const vs = path.join(root, "Microsoft Visual Studio");
    if (!existsSync(vs)) continue;
    for (const year of readdirSync(vs)) {
      const yearDir = path.join(vs, year);
      if (!statSync(yearDir).isDirectory()) continue;
      for (const edition of readdirSync(yearDir)) {
        const bat = path.join(yearDir, edition, "VC", "Auxiliary", "Build", "vcvars64.bat");
        if (existsSync(bat)) return bat;
      }
    }
  }
  return null;
}

console.log("");
await finish("ESP32 LANES");
