/**
 * Unit decks never reach the shipped bank, the bank fingerprint, the content
 * manifest, the handheld (ESP32) export, Study Rooms, or any network path.
 *
 * WHY THIS SUITE EXISTS. The feature's whole safety argument is where a unit deck
 * does NOT go. A unit's own study cards are not Army doctrine and GUIDON has not
 * checked them, so they must not become part of what GUIDON vouches for (the bank,
 * its fingerprint, the reviewed content manifest), must not be copied onto a
 * handheld a Soldier carries, and must never be put on the LAN by a Study Room
 * host. None of those is visible from the screen, and each would be broken by a
 * one-line change (a `store.boardQuestions()` that starts returning unit cards, a
 * new caller of the study accessor, a build step that reads a deck). So each is
 * held here:
 *
 *  1. the assembled bank (the seed plus every build-time pack - what the lints, the
 *     content manifest, the fingerprint and the handheld exporter read) contains no
 *     unit card, and the committed content manifest still matches it exactly;
 *  2. the REAL handheld exporter is run and its cards.ndjson, categories.json and
 *     lanes.json contain no unit id, no "Unit:" category and none of the fictional
 *     deck's words, and the card count is exactly the manifest's;
 *  3. DEFAULT-DENY at the source: store.studyQuestions() is called from exactly Board
 *     Drill, Quiz and Rapid Fire; G.unitDecks.cards() only from studyQuestions itself,
 *     the Readiness screen's own row and global search; nothing in the room modules,
 *     the guest page, the room server or any build tool refers to a unit deck at all;
 *  4. neither unit-deck module is a content pack, so the build never merges one.
 *
 * (The same promises are proved in the running app by test-unit-decks.mjs: with a
 * deck on, boardQuestions() and the seed are unchanged, the bank's fingerprint is
 * unchanged, the Study Rooms deck picker offers no unit category, doctrine search
 * finds nothing of it and no request leaves the page.)
 *
 * Pure node; the exporter runs as a child process, exactly as the release does.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, finish } from "./testkit.mjs";
import { assembleBank } from "./assemble-bank.mjs";
import { loadManifest } from "./content-manifest.mjs";
import { loadModules } from "./module-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const REPO = path.resolve(APP, "..");
const read = (...p) => readFileSync(path.join(...p), "utf8");
const FICTIONAL = ["Pinecone Ridge", "Pinecones", "pine cone", "Squadron song", "Squadron motto"];
const scratch = mkdtempSync(path.join(tmpdir(), "guidon-unit-isolation-"));

try {
  /* -------------------------------------------------- 1. the assembled bank and the content manifest */
  {
    const assembled = assembleBank();
    const bank = assembled.data.board.questions;
    const hit = bank.filter((q) => /^unit:/.test(String(q.id)) || /^Unit: /.test(String(q.category)) || q.unitDeck);
    check(bank.length > 1000 && hit.length === 0, `no unit card is in the assembled bank (${bank.length} cards; none has a unit: id, a "Unit:" category or a unitDeck)`, () => JSON.stringify(hit.slice(0, 2)));
    const blob = JSON.stringify(assembled.data);
    check(!FICTIONAL.some((w) => blob.includes(w)) && !/guidon-unit-pack/.test(blob), "nor is any word of the fictional example deck, or the format name, anywhere in the assembled seed");
    const manifest = loadManifest();
    const mtext = read(HERE, "content-manifest.json");
    check(!/unit[- ]?deck|unit:|guidon-unit-pack/i.test(mtext), "the committed content manifest says nothing about unit decks");
    const r = spawnSync(process.execPath, [path.join(HERE, "content-manifest.mjs")], { encoding: "utf8" });
    check(r.status === 0, "and it still matches the live bank exactly (node tools/content-manifest.mjs exits 0, so the fingerprint is unchanged)", () => (r.stdout + r.stderr).slice(-600));
    check(typeof manifest.fingerprint === "string" && manifest.fingerprint === assembled.data.board.contentHash, "the manifest's fingerprint IS the assembled bank's own (board.contentHash)", () => manifest.fingerprint + " vs " + assembled.data.board.contentHash);

    /* ------------------------------------------------ 2. the handheld exporter, run for real */
    const fw = path.join(REPO, "firmware", "esp32-flashcard-os");
    const out = path.join(scratch, "sdcard");
    const ex = spawnSync(process.execPath, [path.join(fw, "tools", "extract-cards.mjs"), "--out", out], { encoding: "utf8", cwd: fw });
    check(ex.status === 0 && existsSync(path.join(out, "cards.ndjson")), "the real handheld exporter runs to completion", () => (ex.stdout + ex.stderr).slice(-600));
    if (existsSync(path.join(out, "cards.ndjson"))) {
      const nd = readFileSync(path.join(out, "cards.ndjson"), "utf8");
      const lines = nd.split("\n").filter(Boolean);
      const cats = readFileSync(path.join(out, "categories.json"), "utf8");
      const lanes = readFileSync(path.join(out, "lanes.json"), "utf8");
      const ids = lines.map((l) => JSON.parse(l).i);
      check(lines.length === manifest.totals.board, `it wrote exactly the manifest's ${manifest.totals.board} cards`, () => lines.length + " vs " + manifest.totals.board);
      check(!ids.some((i) => /^unit:/.test(String(i))) && !/"Unit: /.test(cats + lanes), "no card id, category or deck on the handheld is a unit deck's", () => "found");
      check(!FICTIONAL.some((w) => nd.includes(w) || cats.includes(w) || lanes.includes(w)), "and none of the fictional deck's words is on the handheld");
    }
  }

  /* -------------------------------------------------- 3. default-deny at the source */
  {
    const strip = (s) => s.split("\n").map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l)).join("\n");
    const html = read(APP, "src", "index.html").split("\n");
    const enclosing = (i) => { for (let k = i; k >= 0 && k > i - 6000; k--) { const m = /^\s*(?:async\s+)?function\s+(\w+)\s*\(/.exec(html[k]); if (m && html[k].length < 400) return m[1]; const g = /^\s{4}(\w+)\(\)\s*\{\s*$/.exec(html[k]); if (g && html[k].length < 400) return g[1]; } return "?"; };
    const sites = (re) => html.map((l, i) => [i, l]).filter(([, l]) => l.length < 20000 && !/^\s*(\/\/|\*|\/\*)/.test(l) && re.test(l));
    const study = sites(/\bstore\.studyQuestions\(\)|\bthis\.studyQuestions\(\)|G\.store\.studyQuestions/).map(([i]) => enclosing(i)).sort();
    check(JSON.stringify(study) === JSON.stringify(["renderDrill", "renderQuiz", "renderRapidFire"]), "store.studyQuestions() is called from exactly Board Drill, Quiz and Rapid Fire - nowhere else", () => JSON.stringify(study));
    const cardsCalls = sites(/unitDecks\.cards\(\)/).map(([i]) => enclosing(i)).sort();
    check(JSON.stringify(cardsCalls) === JSON.stringify(["renderReadiness", "runSearch", "studyQuestions"]),
      "G.unitDecks.cards() is called only by studyQuestions() itself, the Readiness screen's own Unit Deck row and global search", () => JSON.stringify(cardsCalls));
    // The other accessors that mean "the shipped bank" do not mention unit decks at all.
    const bq = read(APP, "src", "index.html");
    const from = bq.indexOf("    boardQuestions() {"), to = bq.indexOf("    // Board questions PLUS the cards of the Soldier's own unit decks");
    check(from > 0 && to > from && !/unit/i.test(bq.slice(from, to).replace(/\/\/[^\n]*/g, "")), "store.boardQuestions() itself does not mention a unit deck: it is exactly the shipped bank", () => "boardQuestions() body mentions unit");
    const ROOMS = ["studygroup.js", "room-schema.js"];
    for (const f of ROOMS) check(!/unitDecks|unitPack|studyQuestions|unit-deck|unit:/.test(strip(read(APP, "src", "app-modules", f))), `src/app-modules/${f} (Study Rooms) never refers to a unit deck`);
    for (const f of ["room-web.js", "room-tauri.js", "guest.html"]) check(!/unitDecks|unitPack|studyQuestions|unit-deck/.test(read(APP, "src", f)), `src/${f} (the room transports and the guest page) never refers to a unit deck`);
    const toolsOff = readdirSync(HERE).filter((f) => /^(room-|build-library|build\.mjs|assemble-bank|content-|perf-seed|shots|gen-room)/.test(f) && f.endsWith(".mjs") && !/^test-/.test(f));
    const leaks = toolsOff.filter((f) => /unitDecks|unitPack|unit-deck|unit-pack|unit:/.test(read(HERE, f)));
    check(toolsOff.length > 5 && leaks.length === 0, `no build, room or content tool (${toolsOff.length} checked) reads a unit deck`, () => leaks.join(", "));
    const esp = read(REPO, "firmware", "esp32-flashcard-os", "tools", "extract-cards.mjs") + read(REPO, "firmware", "esp32-flashcard-os", "tools", "lanes.mjs");
    check(!/unitDecks|unitPack|unit-deck|unit-pack|unit:/.test(esp) && /assembleBank/.test(esp), "the handheld exporter reads only the assembled bank and knows nothing of unit decks");
  }

  /* -------------------------------------------------- 4. never a content pack */
  {
    const { modules } = loadModules();
    const unit = modules.filter((m) => /unit-deck/.test(m.id));
    check(unit.length === 2 && unit.every((m) => m.kind === "feature" && m.emit !== "build"), "both unit-deck modules are runtime features: the build never merges one into the seed", () => JSON.stringify(unit.map((m) => [m.id, m.kind, m.emit])));
    const build = read(HERE, "build.mjs");
    check(!/unit-deck|unitDeck|unit-pack/.test(build), "tools/build.mjs has no special case for them");
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

await finish("UNIT DECKS ISOLATION");
