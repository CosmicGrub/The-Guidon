/**
 * Content manifest: the ratchet is proved on a stand-in bank, and the committed
 * manifest is proved against the real one. Pure node - no browser.
 *
 * tools/content-manifest.mjs replaced every typed content count in the repo
 * (FLOORS = { board: 1230, ... } and friends) with a committed, generated file
 * that may rise freely and may fall only with a recorded reason. A verifier
 * like that is only worth having if it can be shown to fail, so this suite
 * never greps the tool's source: it builds a tiny bank in a temp folder (a
 * one-line seed, a content pack, and the REAL 98-content-pack-finalize.js so the
 * fingerprint is computed the real way), points the real CLI at it with
 * --seed / --modules / --manifest / --docs-root, changes the bank, and reads
 * what the tool does:
 *
 *   - a RISE fails the lint naming the figure, and passes after a plain --write
 *   - a FALL is refused by --write (file untouched), refused again with a
 *     throwaway reason, and recorded - figure, from, to, reason, date - with
 *     --allow-shrink "<reason>"
 *   - a category that vanishes while every total stays the same is a fall too
 *   - a reworded card (fingerprint only) and a re-tagged card are free
 *   - a second --write changes nothing; output is LF with one trailing newline
 *   - a hand-edited, re-indented, conflict-marked or history-doctored manifest
 *     fails in plain words; a pack that will not load stops everything
 *   - --base holds a REVIEW to the same rule: a fall between two manifests with
 *     no new shrinks entry fails, and so does a rewritten history
 *   - a generated figures block in a document goes stale and is regenerated -
 *     and a stand-in bank can never touch the real README
 *
 * Then the real thing: the committed tools/content-manifest.json is exactly what
 * the real bank produces and adds up internally, and the ESP32 card exporter
 * writes the full deck against it but stops, writing nothing, on a planted
 * 61-card gap (the size of the one the 2026-09 audit found on the handheld).
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, copyFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleBank } from "./assemble-bank.mjs";
import { loadManifest, buildFigures, figuresOf, diffFigures, unrecordedFalls, MANIFEST_PATH, FIGURE_DOCS } from "./content-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const TOOL = path.join(HERE, "content-manifest.mjs");
const EXPORTER = path.join(REPO, "firmware", "esp32-flashcard-os", "tools", "extract-cards.mjs");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail === undefined ? pass : fail));
const stderrNoise = [];

/* ---------------------------------------------------------------- stand-in bank */
const scratch = mkdtempSync(path.join(tmpdir(), "guidon-content-manifest-"));
const SEED = path.join(scratch, "index.html");
const MODULES = path.join(scratch, "modules");
const MANIFEST = path.join(scratch, "manifest.json");
const DOCS = path.join(scratch, "docs");
mkdirSync(MODULES); mkdirSync(DOCS);
copyFileSync(path.join(HERE, "..", "src", "app-modules", "98-content-pack-finalize.js"), path.join(MODULES, "98-content-pack-finalize.js"));

const card = (id, category, q = "Question " + id + "?") => ({ id, category, q, a: "Answer " + id, boardAnswer: "Answer " + id });
const seedBank = () => ({
  board: { questions: [card("s1", "Army Values"), card("s2", "Army Values"), card("s3", "Land Navigation"), card("s4", "Land Navigation")] },
  doctrine: { entries: [{ id: "d1", topic: "Counseling" }, { id: "d2", topic: "Counseling" }, { id: "d3", topic: "Operations" }] },
  scenarios: { scenarios: [{ id: "sc-one" }, { id: "sc-two", defaultMode: "training" }] },
  acronyms: { terms: [{ a: "AO" }, { a: "NCO" }, { a: "PCC" }] },
  career: { mos: [{ code: "11B" }, { code: "92A" }], cmfs: [{ id: "11" }] },
  creeds: [{ id: "creed-one" }],
  prt: { drills: [{ id: "pd", exercises: [{}, {}, {}] }] },
});
const writeSeed = (bank) => writeFileSync(SEED, "<!doctype html>\n<script>\nwindow.GUIDON_SEED = " + JSON.stringify(bank) + "\n</script>\n", "utf8");
const writePack = (cards) => writeFileSync(path.join(MODULES, "01-stand-in-pack.js"), "(function () { var S = window.GUIDON_SEED; " + JSON.stringify(cards) + ".forEach(function (c) { S.board.questions.push(c); }); })();\n", "utf8");
const packOf = (n, category = "Army Values") => Array.from({ length: n }, (_, i) => card("p" + (i + 1), category));

const run = (...args) => {
  const r = spawnSync(process.execPath, [TOOL, "--manifest", MANIFEST, "--seed", SEED, "--modules", MODULES, ...args], { encoding: "utf8" });
  if (r.stderr && r.stderr.trim()) stderrNoise.push(args.join(" ") + " -> " + r.stderr.trim().split("\n")[0]);
  return { code: r.status, out: r.stdout || "" };
};
const bytes = () => readFileSync(MANIFEST, "utf8");
const manifest = () => JSON.parse(bytes());
const REASON = "Two stand-in cards were retired on purpose for this test";

try {
  /* ---------------------------------------------------------------- first write */
  console.log("stand-in bank: create, and a second --write is a no-op");
  writeSeed(seedBank()); writePack(packOf(2));
  let r = run();
  check(r.code === 1 && /does not exist/.test(r.out) && /--write/.test(r.out), "with no manifest yet the lint fails and says how to create one", "no-manifest lint: exit " + r.code + "\n" + r.out);
  r = run("--write");
  check(r.code === 0 && existsSync(MANIFEST), "--write creates the manifest and the lint then passes", "first --write: exit " + r.code + "\n" + r.out);
  let m = manifest();
  check(m.totals.board === 6 && m.seedOnly.board === 4 && m.packs["01-stand-in-pack.js"].board === 2 && m.board.byCategory["Army Values"] === 4 && m.board.byCategory["Land Navigation"] === 2,
    "it records the totals, the seed-only split, the per-pack contribution and the per-category counts (6 cards = 4 seed + 2 pack; Army Values 4, Land Navigation 2)", "figures: " + JSON.stringify({ totals: m.totals, seedOnly: m.seedOnly, packs: m.packs, byCategory: m.board.byCategory }));
  check(m.totals.doctrine === 3 && m.doctrine.byTopic.Counseling === 2 && m.totals.scenarios === 2 && m.totals.acronyms === 3 && m.totals.mos === 2 && m.totals.creeds === 1 && m.totals.prtExercises === 3 && m.totals.seedSections === 7,
    "and every other counted kind: doctrine by topic, scenarios, dictionary terms, MOS entries, creeds, PRT exercises, seed sections", "totals: " + JSON.stringify(m.totals));
  check(m.board.byPillar["Drill & Board Etiquette"] === 4 && m.board.byPillar["(none)"] === 2 && m.scenarios.byPillar["Programs & Support"] === 1,
    "per-pillar counts come from the one pillar map (Army Values -> Drill & Board Etiquette; Land Navigation is outside the six by design)", "byPillar: " + JSON.stringify(m.board.byPillar) + " " + JSON.stringify(m.scenarios.byPillar));
  check(/^[0-9a-f]{16}$/.test(m.fingerprint) && Array.isArray(m.shrinks) && m.shrinks.length === 0, "the bank fingerprint is the one the real finalize pass stamps, and the shrinks history starts empty", "fingerprint " + m.fingerprint + " shrinks " + JSON.stringify(m.shrinks));
  const first = bytes();
  check(!first.includes("\r") && first.endsWith("}\n") && !first.endsWith("\n\n"), "the file is LF-only with exactly one trailing newline");
  const stamp = statSync(MANIFEST).mtimeMs;
  r = run("--write");
  check(r.code === 0 && bytes() === first && statSync(MANIFEST).mtimeMs === stamp && /already up to date, nothing written/.test(r.out), "a second --write changes nothing - same bytes, the file is not even rewritten", "second --write: exit " + r.code + "\n" + r.out);

  /* ---------------------------------------------------------------- a rise is free */
  console.log("\na rise is free");
  writePack(packOf(3));
  r = run();
  check(r.code === 1 && /totals\.board: the committed manifest says 6, the live bank has 7 \(up 1\)/.test(r.out) && /board\.byCategory\["Army Values"\].*says 4.*has 5/.test(r.out) && /fingerprint/.test(r.out) && !/FELL/.test(r.out),
    "one more card: the lint fails naming totals.board (6 -> 7), the category (4 -> 5) and the fingerprint, and calls none of it a fall", "rise lint: exit " + r.code + "\n" + r.out);
  check(/node tools\/content-manifest\.mjs --write\n/.test(r.out) && !/--allow-shrink "</.test(r.out.split("stale")[1] || ""), "and the fix it prints is a plain --write, no reason asked for");
  r = run("--write");
  m = manifest();
  check(r.code === 0 && m.totals.board === 7 && m.shrinks.length === 0, "--write accepts the rise with no questions asked and records no shrink", "rise --write: exit " + r.code + "\n" + r.out);
  check(run().code === 0, "and the lint passes again");

  /* ---------------------------------------------------------------- a fall is a decision */
  console.log("\na fall is refused until it is a recorded decision");
  writePack(packOf(1));
  const beforeFall = bytes();
  r = run();
  check(r.code === 1 && /totals\.board: the committed manifest says 7, the live bank has 5 \(FELL by 2\)/.test(r.out) && /--write --allow-shrink "/.test(r.out), "two cards gone: the lint fails, says totals.board FELL by 2, and the fix it prints needs a reason", "fall lint: exit " + r.code + "\n" + r.out);
  r = run("--write");
  check(r.code === 1 && /REFUSED, nothing written/.test(r.out) && /totals\.board/.test(r.out) && /board\.byCategory\["Army Values"\]/.test(r.out) && bytes() === beforeFall,
    "--write REFUSES, names the total and the category that fell, and leaves the file byte-for-byte alone", "refusal: exit " + r.code + " changed=" + (bytes() !== beforeFall) + "\n" + r.out);
  r = run("--write", "--allow-shrink", "oops");
  check(r.code === 1 && /needs the reason/.test(r.out) && bytes() === beforeFall, "a throwaway reason (\"oops\") is refused too, nothing written");
  r = run("--write", "--allow-shrink");
  check(r.code === 1 && bytes() === beforeFall, "--allow-shrink with no reason at all is refused, nothing written");
  r = run("--write", "--allow-shrink", REASON);
  m = manifest();
  const entry = m.shrinks[0] || {};
  const drop = (entry.drops || []).find((d) => d.figure === "totals.board") || {};
  check(r.code === 0 && m.totals.board === 5 && m.shrinks.length === 1 && entry.reason === REASON && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && drop.from === 7 && drop.to === 5 && entry.drops.some((d) => d.figure === 'board.byCategory["Army Values"]' && d.from === 5 && d.to === 3),
    "with a real reason the drop is written AND recorded: reason, date, totals.board 7 -> 5 and the category 5 -> 3", "allow-shrink: exit " + r.code + " shrinks=" + JSON.stringify(m.shrinks) + "\n" + r.out);
  const afterShrink = bytes();
  r = run("--write", "--allow-shrink", REASON);
  check(r.code === 0 && bytes() === afterShrink && /nothing fell/.test(r.out), "running the same command again records nothing new - the history cannot be padded by accident", "repeat allow-shrink: exit " + r.code + "\n" + r.out);

  /* ---------------------------------------------------------------- category / topic falls with totals unchanged */
  console.log("\na fall hidden behind an unchanged total is still a fall");
  const refiled = seedBank(); refiled.board.questions[3].category = "Army Values"; refiled.board.questions[2].category = "Army Values";
  writeSeed(refiled);
  r = run("--write");
  check(r.code === 1 && /REFUSED/.test(r.out) && /board\.byCategory\["Land Navigation"\]/.test(r.out) && /totals\.boardCategories/.test(r.out) && !/totals\.board:/.test(r.out) && bytes() === afterShrink,
    "every card re-filed out of one category (same total): refused, naming the category that vanished", "refile: exit " + r.code + "\n" + r.out);
  const retopic = seedBank(); retopic.doctrine.entries[0].topic = "Operations";
  writeSeed(retopic);
  r = run("--write");
  check(r.code === 1 && /REFUSED/.test(r.out) && /doctrine\.byTopic\.Counseling/.test(r.out) && bytes() === afterShrink, "a doctrine entry moved out of a topic (same total): refused, naming the topic", "retopic: exit " + r.code + "\n" + r.out);

  /* ---------------------------------------------------------------- free moves */
  console.log("\nwhat is not content going missing is free");
  const reworded = seedBank(); reworded.board.questions[0].q = "A reworded question?";
  writeSeed(reworded);
  r = run();
  check(r.code === 1 && /fingerprint: /.test(r.out) && /reworded/.test(r.out) && !/totals\./.test(r.out), "a reworded card changes only the fingerprint: the lint says so, and no count is blamed", "reword lint: exit " + r.code + "\n" + r.out);
  check(run("--write").code === 0 && manifest().shrinks.length === 1, "...and a plain --write takes it");
  const folded = seedBank(); folded.board.questions.push(card("p1", "Army Values"));
  writeSeed(folded); writePack([]);
  r = run("--write");
  m = manifest();
  check(r.code === 0 && m.totals.board === 5 && m.seedOnly.board === 5 && !m.packs["01-stand-in-pack.js"] && m.shrinks.length === 1, "a pack folded into the seed (same cards, same total) is free: per-pack contributions and the seed-only split are exact but not ratcheted", "fold: exit " + r.code + " " + JSON.stringify({ seedOnly: m.seedOnly, packs: m.packs }) + "\n" + r.out);
  writeSeed(seedBank()); writePack(packOf(1));
  check(run("--write").code === 0, "(bank restored for the next checks)");
  const settled = bytes();

  /* ---------------------------------------------------------------- a manifest nobody should trust */
  console.log("\na manifest nobody should trust fails in plain words");
  writeFileSync(MANIFEST, JSON.stringify(JSON.parse(settled)) + "\n", "utf8");
  r = run();
  check(r.code === 1 && /not byte-for-byte what --write generates/.test(r.out), "right figures, re-indented by hand: fails as not what --write generates", "reindent: exit " + r.code + "\n" + r.out);
  const doctored = JSON.parse(settled); doctored.shrinks[0].reason = "n/a";
  writeFileSync(MANIFEST, JSON.stringify(doctored, null, 2) + "\n", "utf8");
  r = run();
  check(r.code === 1 && /needs a real "reason"/.test(r.out), "a shrinks entry with its reason hollowed out fails", "hollow reason: exit " + r.code + "\n" + r.out);
  writeFileSync(MANIFEST, "<<<<<<< HEAD\n" + settled + "=======\n" + settled + ">>>>>>> other\n", "utf8");
  const conflicted = bytes();
  r = run();
  check(r.code === 1 && /not valid JSON/.test(r.out) && /unresolved merge/.test(r.out), "merge-conflict markers: fails, and says it looks like an unresolved merge", "conflict lint: exit " + r.code + "\n" + r.out);
  r = run("--write");
  check(r.code === 1 && bytes() === conflicted, "...and --write will not paper over it (the shrinks history lives in that file) - nothing written");
  writeFileSync(MANIFEST, settled, "utf8");
  writeFileSync(path.join(MODULES, "02-broken-pack.js"), "(function () { this is not javascript", "utf8");
  r = run("--write");
  check(r.code === 1 && /02-broken-pack\.js/.test(r.out) && /nothing compared, nothing written/.test(r.out) && bytes() === settled, "a pack that will not load stops everything - a short bank is never compared or written", "broken pack: exit " + r.code + "\n" + r.out);
  rmSync(path.join(MODULES, "02-broken-pack.js"));
  r = run("--wirte");
  check(r.code === 1 && /unknown option --wirte/.test(r.out), "a mistyped option fails instead of quietly running the lint");
  // A stand-in flag with its value missing must not fall back to the REAL file.
  const realBefore = readFileSync(MANIFEST_PATH, "utf8");
  const lost = spawnSync(process.execPath, [TOOL, "--seed", SEED, "--modules", MODULES, "--manifest", "--write"], { encoding: "utf8" });
  check(lost.status === 1 && /--manifest needs a value/.test(lost.stdout || "") && readFileSync(MANIFEST_PATH, "utf8") === realBefore, "--manifest with its value missing stops before anything is compared or written - a stand-in bank can never be written over the committed manifest", "valueless --manifest: exit " + lost.status + " realChanged=" + (readFileSync(MANIFEST_PATH, "utf8") !== realBefore) + "\n" + lost.stdout);
  r = run("--allow-shrink", REASON);
  check(r.code === 1 && /only means something together with --write/.test(r.out), "--allow-shrink without --write fails: the lint never records anything");

  /* ---------------------------------------------------------------- --base: the review ratchet */
  console.log("\n--base holds a review to the same rule");
  const BASE = path.join(scratch, "base.json");
  const richer = JSON.parse(settled); richer.totals.board += 3; richer.board.byCategory["Army Values"] += 3; richer.shrinks = [];
  writeFileSync(BASE, JSON.stringify(richer, null, 2) + "\n", "utf8");
  const noHistory = JSON.parse(settled); noHistory.shrinks = [];
  writeFileSync(MANIFEST, JSON.stringify(noHistory, null, 2) + "\n", "utf8");
  r = run("--base", BASE);
  check(r.code === 1 && /ratchet vs .*totals\.board fell from 8 to 5 with no shrinks entry/.test(r.out), "three cards fewer than the earlier manifest and no shrinks entry (a hand-edit past --write): fails naming totals.board", "base unrecorded: exit " + r.code + "\n" + r.out);
  const recorded = JSON.parse(JSON.stringify(noHistory));
  recorded.shrinks = [{ date: "2026-09-19", appVersion: null, reason: REASON, drops: [{ figure: "totals.board", from: 8, to: 5 }, { figure: 'board.byCategory["Army Values"]', from: 6, to: 3 }] }];
  writeFileSync(MANIFEST, JSON.stringify(recorded, null, 2) + "\n", "utf8");
  r = run("--base", BASE);
  check(r.code === 0 && /nothing fell without a recorded reason/.test(r.out), "the same fall WITH a new shrinks entry naming both figures passes", "base recorded: exit " + r.code + "\n" + r.out);
  const baseWithHistory = JSON.parse(JSON.stringify(richer)); baseWithHistory.shrinks = [{ date: "2026-01-01", appVersion: null, reason: "An older, already reviewed removal of content", drops: [{ figure: "totals.board", from: 9, to: 8 }] }];
  writeFileSync(BASE, JSON.stringify(baseWithHistory, null, 2) + "\n", "utf8");
  r = run("--base", BASE);
  check(r.code === 1 && /history was rewritten/.test(r.out), "an earlier shrinks entry that has gone missing fails: the history only grows", "base rewritten: exit " + r.code + "\n" + r.out);
  check(unrecordedFalls(richer, recorded).length === 0 && unrecordedFalls(richer, noHistory).length === 2, "(the same verdicts straight from unrecordedFalls(): 0 problems when recorded, 2 when not)");
  writeFileSync(MANIFEST, settled, "utf8");

  /* ---------------------------------------------------------------- documents */
  console.log("\ngenerated figures blocks in documents");
  const realDocsBefore = FIGURE_DOCS.map((rel) => { const f = path.join(REPO, rel); return existsSync(f) ? readFileSync(f, "utf8") : null; });
  check(FIGURE_DOCS.length > 0, "at least one document carries a generated figures block (" + FIGURE_DOCS.join(", ") + ")", "FIGURE_DOCS is empty - no document carries the generated block");
  const docText = (block) => "# Stand-in\n\nProse before.\n\n" + block + "\n\nProse after, with a number that must survive: 1,014.\n";
  for (const rel of FIGURE_DOCS) { mkdirSync(path.dirname(path.join(DOCS, rel)), { recursive: true }); writeFileSync(path.join(DOCS, rel), docText("<!-- content-figures:start -->\n| stale | 1 |\n<!-- content-figures:end -->"), "utf8"); }
  r = run("--docs-root", DOCS);
  check(r.code === 1 && FIGURE_DOCS.every((rel) => r.out.includes("the generated figures block in " + rel + " is stale")), "a stale block fails the lint, naming each document", "stale docs: exit " + r.code + "\n" + r.out);
  r = run("--write", "--docs-root", DOCS);
  const regenerated = FIGURE_DOCS.map((rel) => readFileSync(path.join(DOCS, rel), "utf8"));
  check(r.code === 0 && regenerated.every((t) => /\| Board study cards \| 5 in 2 categories \|/.test(t) && /\| Doctrine entries \| 3 in 2 topics \|/.test(t) && t.startsWith("# Stand-in\n\nProse before.\n\n<!-- content-figures:start") && t.endsWith("Prose after, with a number that must survive: 1,014.\n") && !/stale/.test(t)),
    "--write regenerates only the block - the live figures go in, every byte around it survives", "regen: exit " + r.code + "\n" + r.out + "\n" + regenerated[0]);
  r = run("--write", "--docs-root", DOCS);
  check(r.code === 0 && FIGURE_DOCS.every((rel, i) => readFileSync(path.join(DOCS, rel), "utf8") === regenerated[i]), "a second --write leaves the documents alone");
  writeFileSync(path.join(DOCS, FIGURE_DOCS[0]), "# Stand-in\n\nThe block was deleted.\n", "utf8");
  r = run("--docs-root", DOCS);
  check(r.code === 1 && r.out.includes(FIGURE_DOCS[0] + " has lost its generated figures block"), "a listed document that lost its block fails - the list may only describe reality", "lost block: exit " + r.code + "\n" + r.out);
  check(FIGURE_DOCS.every((rel, i) => { const f = path.join(REPO, rel); return (existsSync(f) ? readFileSync(f, "utf8") : null) === realDocsBefore[i]; }), "through all of that the REAL documents were never touched: a stand-in bank without --docs-root leaves documents alone");

  /* ---------------------------------------------------------------- the real manifest */
  console.log("\nthe committed manifest vs the real bank");
  const real = spawnSync(process.execPath, [TOOL], { encoding: "utf8" });
  if (real.stderr && real.stderr.trim()) stderrNoise.push("real lint -> " + real.stderr.trim().split("\n")[0]);
  check(real.status === 0 && /CONTENT-MANIFEST: all passed/.test(real.stdout), "node tools/content-manifest.mjs passes on this tree (the exact command lint:patterns runs)", "real lint: exit " + real.status + "\n" + real.stdout);
  check(/live figures, any time: node tools\/content-manifest\.mjs --figures/.test(real.stdout), "and it ends by saying where the live figures are, so nobody types one into a document");
  // --base-ref is --base with the earlier manifest read out of git, which is how
  // a pull request is held to the ratchet (against the branch it merges into).
  const viaRef = (ref) => { const x = spawnSync(process.execPath, [TOOL, "--base-ref", ref], { encoding: "utf8" }); return { code: x.status, out: x.stdout || "" }; };
  let g = viaRef("HEAD");
  check(g.code === 0 && /ratchet vs HEAD:|has no guidon-app\/tools\/content-manifest\.json yet/.test(g.out), "--base-ref HEAD: nothing in this working tree fell below the last commit without a recorded reason", "--base-ref HEAD: exit " + g.code + "\n" + g.out);
  g = viaRef("no-such-ref-for-this-test");
  check(g.code === 1 && /git cannot find "no-such-ref-for-this-test"/.test(g.out) && /NOT checked/.test(g.out), "--base-ref with a ref git cannot find FAILS, saying the ratchet was not checked - it never passes by default");
  const committed = loadManifest();
  const liveFigures = buildFigures(assembleBank());
  check(diffFigures(committed, liveFigures).length === 0 && JSON.stringify(figuresOf(committed)) === JSON.stringify(figuresOf(liveFigures)), `imported directly, buildFigures(assembleBank()) is the committed file, key for key, in the same order (${committed.totals.board} cards, fingerprint ${committed.fingerprint})`, "differences: " + JSON.stringify(diffFigures(committed, liveFigures).slice(0, 6)));
  const total = (o) => Object.values(o).reduce((n, v) => n + v, 0);
  const packSum = (kind) => Object.values(committed.packs).reduce((n, p) => n + p[kind], 0);
  check(total(committed.board.byCategory) === committed.totals.board && total(committed.board.byPillar) === committed.totals.board && Object.keys(committed.board.byCategory).length === committed.totals.boardCategories
    && total(committed.doctrine.byTopic) === committed.totals.doctrine && total(committed.doctrine.byPillar) === committed.totals.doctrine && total(committed.scenarios.byPillar) === committed.totals.scenarios
    && ["board", "doctrine", "scenarios"].every((k) => committed.seedOnly[k] + packSum(k) === committed.totals[k]),
    "it adds up: categories, topics and pillars each sum to their total, and seed-only + per-pack contributions = every total", "internal sums do not close: " + JSON.stringify({ totals: committed.totals, seedOnly: committed.seedOnly }));
  const sortedKeys = (o) => { const k = Object.keys(o); return JSON.stringify(k) === JSON.stringify(k.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))); };
  check(sortedKeys(committed.board.byCategory) && sortedKeys(committed.doctrine.byTopic), "category and topic names are in code-unit order, so the file diffs the same on every machine");

  /* ---------------------------------------------------------------- the ESP32 exporter */
  console.log("\nthe ESP32 card exporter is held to the manifest");
  const OUT = path.join(scratch, "sdcard");
  const exp = (...args) => spawnSync(process.execPath, [EXPORTER, ...args], { encoding: "utf8", cwd: scratch });
  let e = exp("--out", OUT);
  const exportedLines = existsSync(path.join(OUT, "cards.ndjson")) ? readFileSync(path.join(OUT, "cards.ndjson"), "utf8").split("\n").filter(Boolean).length : -1;
  const exportedCats = existsSync(path.join(OUT, "categories.json")) ? JSON.parse(readFileSync(path.join(OUT, "categories.json"), "utf8")) : [];
  check(e.status === 0 && exportedLines === committed.totals.board && exportedCats.length === committed.totals.boardCategories && exportedCats.every((c) => committed.board.byCategory[c.name] === c.count),
    `against the committed manifest it writes the whole deck: ${exportedLines} cards in ${exportedCats.length} categories, each the manifest's size`, "export: exit " + e.status + " lines=" + exportedLines + "\n" + (e.stdout || "") + (e.stderr || ""));
  const GAP = 61;
  const short = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")); short.totals.board += GAP; short.board.byCategory[Object.keys(short.board.byCategory)[0]] += GAP;
  const SHORT = path.join(scratch, "manifest-plus-61.json");
  writeFileSync(SHORT, JSON.stringify(short, null, 2) + "\n", "utf8");
  const OUT2 = path.join(scratch, "sdcard-short");
  e = exp("--out", OUT2, "--manifest", SHORT);
  check(e.status !== 0 && /NOTHING WAS WRITTEN/.test(e.stderr || "") && new RegExp("\\(" + GAP + " missing\\)").test(e.stderr || "") && (e.stderr || "").includes('category "' + Object.keys(short.board.byCategory)[0] + '"') && !existsSync(OUT2),
    `a deck ${GAP} cards short of the manifest: the exporter stops, names the total and the category, and writes nothing - not even the folder`, "short export: exit " + e.status + " folderExists=" + existsSync(OUT2) + "\n" + (e.stderr || "").slice(0, 600));
  const wrongPrint = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")); wrongPrint.fingerprint = "0000000000000000";
  writeFileSync(SHORT, JSON.stringify(wrongPrint, null, 2) + "\n", "utf8");
  e = exp("--out", OUT2, "--manifest", SHORT);
  check(e.status !== 0 && /bank fingerprint/.test(e.stderr || "") && !existsSync(OUT2), "same counts but a different bank fingerprint (a reworded card the manifest never saw) stops it too");

  check(stderrNoise.length === 0, "the manifest tool wrote nothing to stderr in any run (every verdict is a PASS/FAIL line on stdout)", "stderr noise: " + stderrNoise.join(" | "));
} finally {
  try { rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* a temp folder the OS will reap */ }
}

console.log(fails === 0 ? "\nCONTENT MANIFEST: all passed" : `\nCONTENT MANIFEST: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
