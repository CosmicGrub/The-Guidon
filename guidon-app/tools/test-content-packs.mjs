/**
 * Content packs: the running page and the headless assembler must be the
 * SAME bank.
 *
 * tools/assemble-bank.mjs evaluates the static seed plus every headless
 * src/app-modules module (manifest.json) with no browser, so that the lints, the consistency
 * counts and the ESP32 card exporter all see what a Soldier actually gets.
 * That is only worth anything if it is true - so this suite loads the REAL
 * built page and compares it, field by field, with the assembler's output:
 * same counts, same ids in the same order, same category / pillar on every
 * card, same study-room fingerprint.
 *
 * It also pins the two jobs of 98-content-pack-finalize.js:
 *   - pillar tags come from the ONE definition (tools/pillar-map.mjs, injected
 *     by the build as window.GUIDON_PILLAR_MAP), so no pack card whose
 *     category is mapped is left out of the pillar filter / Readiness rollup
 *     (a hand-copied table in the first pack had already drifted: it lacked
 *     "Discipline");
 *   - the bank fingerprint is stamped LAST, from the final bank (the earlier
 *     restamp ran fourth of fifteen modules, so every later pack changed the
 *     deck without changing its fingerprint).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { assembleBank } from "./assemble-bank.mjs";
import { runtimePillarMap, pillarForBoard } from "./pillar-map.mjs";
import { loadManifest } from "./content-manifest.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const headless = assembleBank();
const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.G && G.contentPacks && G.contentPacks.finalized, null, { timeout: 15000 }).catch(() => {});

const live = await page.evaluate(() => {
  const S = window.GUIDON_SEED;
  return {
    board: S.board.questions.map((q) => [q.id, q.category, q.pillar || null]),
    doctrine: S.doctrine.entries.map((e) => [e.id, e.topic, e.pillar || null]),
    scenarios: S.scenarios.scenarios.map((s) => [s.id, s.pillar || null]),
    hash: S.board.contentHash,
    fin: (window.G && G.contentPacks && G.contentPacks.finalized) || null,
    map: window.GUIDON_PILLAR_MAP || null,
    storeCount: G.store.boardQuestions().length,
  };
});

/* ---- the headless assembler is trustworthy ---- */
const broken = headless.modules.filter((m) => m.error);
broken.length === 0 ? ok(`all ${headless.modules.length} headless modules (src/app-modules/manifest.json) load with no DOM`) : bad("modules failed headlessly: " + JSON.stringify(broken));
const hb = headless.data.board.questions.map((q) => [q.id, q.category, q.pillar || null]);
const hd = headless.data.doctrine.entries.map((e) => [e.id, e.topic, e.pillar || null]);
const hs = headless.data.scenarios.scenarios.map((s) => [s.id, s.pillar || null]);
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return { index: i, page: a[i] || null, headless: b[i] || null }; return null; };
for (const [label, a, b] of [["board cards", live.board, hb], ["doctrine entries", live.doctrine, hd], ["scenarios", live.scenarios, hs]]) {
  const d = firstDiff(a, b);
  d === null ? ok(`${a.length} ${label}: the built page and the headless assembler agree on every id, in order, with the same category/topic and pillar`) : bad(`${label} differ between the page and the assembler at ${JSON.stringify(d)}`);
}
live.hash === headless.data.board.contentHash ? ok(`same study-room fingerprint in the page and headless (${live.hash})`) : bad(`fingerprint: page ${live.hash} vs headless ${headless.data.board.contentHash}`);

/* ---- the committed manifest describes THIS bank ----
   tools/content-manifest.json is what the ESP32 exporter and the other suites
   trust instead of a typed count, so it has to be tied to the real page, not
   only to the assembler that generated it. test-consistency compares every
   figure the page can know; this adds the two it cannot - which file each
   record came from - by closing the arithmetic against the page's own totals. */
const manifest = loadManifest();
live.hash === manifest.fingerprint ? ok(`the committed content manifest carries this page's fingerprint (${manifest.fingerprint})`) : bad(`tools/content-manifest.json fingerprint ${manifest.fingerprint} is not the built page's ${live.hash} - run: node tools/content-manifest.mjs --write`);
for (const kind of ["board", "doctrine", "scenarios"]) {
  const fromPacks = Object.values(manifest.packs).reduce((n, p) => n + p[kind], 0);
  manifest.seedOnly[kind] + fromPacks === live[kind].length
    ? ok(`manifest ${kind}: ${manifest.seedOnly[kind]} in the seed + ${fromPacks} from packs = the ${live[kind].length} the built page holds`)
    : bad(`manifest ${kind}: ${manifest.seedOnly[kind]} seed + ${fromPacks} from packs is not the ${live[kind].length} the built page holds - run: node tools/content-manifest.mjs --write`);
}
const addsSomething = (a) => a.board || a.doctrine || a.scenarios;
const reallyAdded = Object.fromEntries(headless.modules.filter((m) => addsSomething(m.added)).map((m) => [m.file, m.added]));
JSON.stringify(reallyAdded) === JSON.stringify(manifest.packs)
  ? ok(`the manifest's per-pack contributions are what each of the ${Object.keys(reallyAdded).length} contributing pack files really adds, in load order`)
  : bad(`per-pack contributions differ - manifest ${JSON.stringify(manifest.packs)} vs loaded ${JSON.stringify(reallyAdded)}`);

/* ---- finalize pass: one pillar definition, fingerprint stamped last ---- */
JSON.stringify(live.map) === JSON.stringify(runtimePillarMap()) ? ok("the build injects tools/pillar-map.mjs into the page verbatim (window.GUIDON_PILLAR_MAP)") : bad("window.GUIDON_PILLAR_MAP differs from tools/pillar-map.mjs runtimePillarMap()");
(live.fin && live.fin.hadMap && live.fin.cards === live.board.length) ? ok(`the finalize pass ran last over the full bank (${live.fin.cards} cards) from the injected map`) : bad("finalize state: " + JSON.stringify(live.fin));
(live.fin && Array.isArray(live.fin.corrections) && live.fin.corrections.length === 0) ? ok("no pack's own pillar had to be overruled by the map") : bad("finalize overruled pack pillars: " + JSON.stringify(live.fin && live.fin.corrections));
const packIds = new Set(headless.data.board.questions.filter((q) => q.__pack).map((q) => q.id));
const untagged = headless.data.board.questions.filter((q) => packIds.has(q.id) && pillarForBoard(q) && q.pillar !== pillarForBoard(q)).map((q) => q.id);
untagged.length === 0 ? ok(`every one of the ${packIds.size} pack cards whose category is mapped carries that pillar (none left out of the pillar filter)`) : bad("pack cards missing their mapped pillar: " + JSON.stringify(untagged.slice(0, 8)));
const lastPackCard = headless.data.board.questions[headless.data.board.questions.length - 1];
const mutated = await page.evaluate((id) => {
  // Recompute the same fingerprint WITHOUT the last card: if it still equals
  // the stamped one, the last pack was never covered by the fingerprint.
  const qs = window.GUIDON_SEED.board.questions.filter((q) => q.id !== id);
  let h1 = 0x811c9dc5 >>> 0, h2 = 0x9e3779b9 >>> 0;
  const feed = (s) => { s = String(s == null ? "" : s); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0; h2 ^= (c + i) & 0xffff; h2 = Math.imul(h2, 0x85ebca6b) >>> 0; } h1 ^= 31; h1 = Math.imul(h1, 0x01000193) >>> 0; h2 ^= 127; h2 = Math.imul(h2, 0xc2b2ae35) >>> 0; };
  qs.forEach((q) => { feed(q.id); feed(q.category); feed(q.q); feed(q.boardAnswer || q.a); });
  const hex = (n) => ("00000000" + (n >>> 0).toString(16)).slice(-8);
  return hex(h1) + hex(h2);
}, lastPackCard.id);
mutated !== live.hash ? ok(`the fingerprint covers the LAST card a pack adds (${lastPackCard.id}): dropping it changes the fingerprint`) : bad("the fingerprint does not change when the last pack card is removed - it was stamped before the last pack loaded");
live.storeCount === live.board.length ? ok(`G.store.boardQuestions() serves the whole assembled bank (${live.storeCount})`) : bad(`store serves ${live.storeCount} of ${live.board.length} cards`);

noise.length === 0 ? ok("no console errors/warnings or page errors") : bad("console noise: " + noise.join(" | "));
console.log(fails === 0 ? "\nCONTENT PACKS: all passed" : `\nCONTENT PACKS: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
