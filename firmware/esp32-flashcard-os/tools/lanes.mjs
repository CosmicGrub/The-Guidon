/**
 * lanes: which DECK of the handheld each card belongs to.
 *
 * The full GUIDON app hides every MOS-specific card (92A, 68W, ...) until a
 * Soldier opts in from Settings (guidon-app/src/app-modules/00-mos-decks-core.js,
 * ROADMAP 3g item G). The handheld used to ignore that rule: extract-cards.mjs
 * wrote the whole assembled bank, MOS cards included, into one list, so a 68W
 * medic's cards sat in every Soldier's subject list. A LANE is the handheld's
 * version of the opt-in:
 *
 *   - the DEFAULT lane ("default", shown as "Standard deck") is every card
 *     that carries no MOS tag - and none that does;
 *   - each MOS deck registered in the bank's mosDecks list is its own lane,
 *     holding exactly the cards tagged with that code.
 *
 * A Soldier picks the deck on the device (Settings -> Deck); until they do the
 * handheld shows the default lane only.
 *
 * WHAT IS WRITTEN (next to cards.ndjson and categories.json):
 *   /lanes.json      {"schema":1,"lanes":[{"id","label","count","categories":[names]}, ...]}
 *                    default lane first, then MOS lanes in the app's own order
 *                    (G.mosDecks.available(): sorted by label).
 *   /categories.json every entry gains "lanes":[ids] - the lanes it belongs to.
 *                    Everything else about it, and every byte of cards.ndjson,
 *                    is what it was before lanes existed, so a handheld still
 *                    running older firmware reads the same files and shows the
 *                    whole bank exactly as it always did.
 *
 * A SUBJECT (one categories.json entry) is a run of cards that share BOTH a
 * category and a lane membership. Today every category is wholly in one lane
 * (the MOS decks own categories of their own), so a subject is a category and
 * nothing here changes their number or order. If a category ever mixes
 * (a 92A card filed under a shared category), it is split into one subject per
 * membership - two entries with the same name, each in its own lane - rather
 * than letting an MOS card ride into the default lane. A card tagged for two
 * MOS decks is written once and listed in both lanes.
 *
 * THE MOS REGISTRY IS READ THE APP'S OWN WAY: 00-mos-decks-core.js is run
 * against the assembled bank in a sandbox and asked for G.mosDecks.available()
 * and normalize(), so this file has no second copy of "which decks exist" or
 * "how a code is normalised" to drift out of step with the app.
 *
 * FAIL CLOSED, in the manner of the manifest check in extract-cards.mjs:
 * every check below is computed from the very text about to be written, and
 * a mismatch names the figure that is off and writes nothing.
 *
 * The numbers in LIMITS are the handheld's own (src/lanes.h and the arrays in
 * src/main.cpp); guidon-app/tools/test-esp32-lanes.mjs reads those files and
 * fails if either side moves without the other.
 */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readManifest, APP_MODULE_DIR } from "../../../guidon-app/tools/module-manifest.mjs";

export const LANES_SCHEMA = 1;
export const DEFAULT_LANE_ID = "default";
export const DEFAULT_LANE_LABEL = "Standard deck";
/** id/label: characters that fit the handheld's buffers (LANE_ID_LEN 12 and
 *  LANE_LABEL_LEN 44 including the end mark; the label is kept shorter still so
 *  it fits one line of the deck button). lanes/categories: array sizes. */
export const LIMITS = { lanes: 16, laneId: 11, laneLabel: 40, categories: 128 };

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The registered MOS decks, read exactly as the app reads them. */
export function mosRegistry(data, moduleDir = APP_MODULE_DIR) {
  const { manifest } = readManifest(moduleDir);
  const entry = (manifest.modules || []).find((m) => m.id === "mos-decks-core");
  if (!entry) throw new Error("lanes: the app's module manifest has no 'mos-decks-core' module - cannot read which MOS decks exist");
  const src = readFileSync(path.join(moduleDir, entry.file), "utf8");
  const window = { GUIDON_SEED: data };
  vm.runInNewContext(src, { window }, { filename: entry.file });
  const api = window.G && window.G.mosDecks;
  if (!api || typeof api.available !== "function" || typeof api.normalize !== "function") throw new Error(`lanes: ${entry.file} did not provide G.mosDecks.available()/normalize() - cannot read which MOS decks exist`);
  return { decks: api.available(), normalize: api.normalize };
}

// En/em dash, curly single and curly double quotes: spelled by code point so the
// source stays plain ASCII.
const charClass = (...codes) => new RegExp("[" + String.fromCharCode(...codes) + "]", "g");
const DASHES = charClass(0x2013, 0x2014), SINGLE_QUOTES = charClass(0x2018, 0x2019), DOUBLE_QUOTES = charClass(0x201C, 0x201D);

/** What fits on the deck button: plain ASCII (the handheld's built-in font has
 *  no other characters), one line, no trailing "(...)" when that is what makes
 *  it too long. */
export function deviceLabel(raw, code) {
  const max = LIMITS.laneLabel;
  let s = String(raw == null ? "" : raw)
    .replace(DASHES, "-").replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"')
    .replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
  if (!s) s = String(code);
  if (s.length > max) {
    const noParen = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (noParen) s = noParen;
  }
  if (s.length > max) {
    // Cut at a word boundary, never mid-word.
    const cut = s.slice(0, max - 3);
    s = (s[max - 3] === " " ? cut : cut.replace(/\s+\S*$/, "")).replace(/[\s,;:-]+$/, "") + "...";
  }
  return s;
}

/** The lane ids one card belongs to, and any MOS tag no registered deck owns.
 *  No tags = the default lane. Mirrors how the app treats a tag: normalised,
 *  matched against the registered codes. */
export function laneIdsOfCard(q, registry) {
  const tags = Array.isArray(q && q.mos) ? q.mos : [];
  if (!tags.length) return { ids: [DEFAULT_LANE_ID], unknown: [] };
  const known = new Set(registry.decks.map((d) => d.code));
  const ids = new Set(), unknown = [];
  for (const t of tags) {
    const code = registry.normalize(t);
    if (known.has(code)) ids.add(code); else unknown.push(String(t));
  }
  return { ids: [...ids].sort(byCodeUnit), unknown };
}

/** Group the bank's board cards into subjects and lanes. Pure: nothing but
 *  the cards and the registry go in. Returns { ndjson, categories, lanes,
 *  problems } - problems are things that stop an export (a tag no deck owns,
 *  more decks or subjects than the handheld can hold), in plain words. */
export function buildExport(cards, registry) {
  const problems = [];
  const order = [];
  const bySegment = new Map();
  for (const q of cards) {
    const cat = q.category || "(uncategorized)";
    const { ids, unknown } = laneIdsOfCard(q, registry);
    if (unknown.length) problems.push(`card ${q.id} ("${cat}") is tagged for MOS ${unknown.map((u) => `"${u}"`).join(", ")}, but no MOS deck with that code is registered - the app would hide it from everyone`);
    const key = ids.join(",") + "\u0000" + cat;
    if (!bySegment.has(key)) { bySegment.set(key, { cat, ids, cards: [] }); order.push(key); }
    bySegment.get(key).cards.push(q);
  }

  let ndjson = "";
  const categories = [];
  for (const key of order) {
    const seg = bySegment.get(key);
    const offset = Buffer.byteLength(ndjson, "utf8");
    for (const q of seg.cards) ndjson += JSON.stringify({ i: q.id, c: seg.cat, q: q.q, a: q.boardAnswer || q.a }) + "\n";
    categories.push({ name: seg.cat, count: seg.cards.length, offset, lanes: seg.ids });
  }

  const laneIds = [DEFAULT_LANE_ID, ...registry.decks.map((d) => d.code)];
  const lanes = [];
  for (const id of laneIds) {
    const entries = categories.filter((c) => c.lanes.includes(id));
    const count = entries.reduce((n, c) => n + c.count, 0);
    if (id !== DEFAULT_LANE_ID && count === 0) continue; // a registered deck with no cards has nothing to pick
    const deck = registry.decks.find((d) => d.code === id);
    lanes.push({ id, label: id === DEFAULT_LANE_ID ? DEFAULT_LANE_LABEL : deviceLabel(deck.label, id), count, categories: entries.map((c) => c.name) });
  }

  if (lanes.length > LIMITS.lanes) problems.push(`${lanes.length} decks (lanes), but the handheld holds at most ${LIMITS.lanes} (LANES_MAX in src/lanes.h)`);
  if (categories.length > LIMITS.categories) problems.push(`${categories.length} subjects, but the handheld holds at most ${LIMITS.categories} (MAX_CATEGORIES in src/main.cpp) - the rest would silently not appear`);
  for (const l of lanes) if (l.id.length > LIMITS.laneId) problems.push(`deck code "${l.id}" is ${l.id.length} characters, the handheld holds ${LIMITS.laneId}`);
  return { ndjson, categories, lanes, problems };
}

/** The text of lanes.json. FAIL CLOSED, at the very last step: a list with no
 *  default lane is never turned into a file. The device treats a lanes.json
 *  with no default deck as unusable (src/lanes.h, laneUsable) - an MOS deck
 *  must only ever be opened by the Soldier choosing it, and a file of MOS decks
 *  alone would leave the device nothing safe to start on - so writing one would
 *  only ever be a mistake. laneMismatches() names the problem first; this is
 *  the backstop should anything ever call the serializer without it. */
export const lanesJson = (lanes) => {
  if (!Array.isArray(lanes) || !lanes.some((l) => l && l.id === DEFAULT_LANE_ID)) {
    throw new Error(`lanes: refusing to write a lanes.json with no "${DEFAULT_LANE_ID}" lane - the handheld cannot start on, or fall back to, a deck it was not told is the Standard one`);
  }
  return JSON.stringify({ schema: LANES_SCHEMA, lanes });
};

/** The check extract-cards.mjs has always made, against the content manifest:
 *  count the export back from the very text about to be written. Returns the
 *  mismatches, in plain words. A category split across lanes is counted whole. */
export function exportMismatches(ndjson, categories, fingerprint, manifest) {
  const problems = [];
  const lines = ndjson.split("\n").filter(Boolean);
  if (lines.length !== manifest.totals.board) problems.push(`cards: exporting ${lines.length}, the content manifest says ${manifest.totals.board} (${lines.length < manifest.totals.board ? manifest.totals.board - lines.length + " missing" : lines.length - manifest.totals.board + " extra"})`);
  const exported = new Map();
  for (const c of categories) exported.set(c.name, (exported.get(c.name) || 0) + c.count);
  const reviewed = manifest.board.byCategory;
  for (const name of new Set([...exported.keys(), ...Object.keys(reviewed)])) {
    const got = exported.get(name) || 0, want = reviewed[name] || 0;
    if (got !== want) problems.push(`category "${name}": exporting ${got}, the content manifest says ${want}`);
  }
  const perCategory = categories.reduce((n, c) => n + c.count, 0);
  if (perCategory !== lines.length) problems.push(`categories.json adds up to ${perCategory} cards but cards.ndjson has ${lines.length} lines`);
  if (fingerprint !== manifest.fingerprint) problems.push(`bank fingerprint: this bank is ${fingerprint}, the content manifest says ${manifest.fingerprint}`);
  return problems;
}

/** The lane checks: the deck lists hold what the bank's own MOS tags say, the
 *  default lane holds no MOS card, and every MOS lane and the default lane add
 *  up to the content manifest. `cards` is the bank's board cards; `ndjson`,
 *  `categories`, `lanes` are what buildExport returned. Returns the
 *  mismatches, in plain words. */
export function laneMismatches({ ndjson, categories, lanes }, cards, registry, manifest) {
  const problems = [];
  const lines = ndjson.split("\n").filter(Boolean);

  // 1. The subjects tile cards.ndjson exactly: each one starts where the
  //    device will seek to, holds the cards it says it does, and they are all
  //    filed under its name. Then say which lane each written card is in.
  const written = new Map(); // lane id -> Map(line text -> times)
  const note = (id, line) => { if (!written.has(id)) written.set(id, new Map()); const m = written.get(id); m.set(line, (m.get(line) || 0) + 1); };
  let at = 0, byteAt = 0;
  for (const c of categories) {
    if (c.offset !== byteAt) problems.push(`subject "${c.name}" starts at byte ${c.offset} in categories.json but its first card is at byte ${byteAt} in cards.ndjson`);
    if (!Array.isArray(c.lanes) || !c.lanes.length) problems.push(`subject "${c.name}" is in no lane`);
    for (let i = 0; i < c.count; i++, at++) {
      const line = lines[at];
      if (line === undefined) { problems.push(`subject "${c.name}" says ${c.count} cards but cards.ndjson runs out`); break; }
      byteAt += Buffer.byteLength(line, "utf8") + 1;
      let card = null;
      try { card = JSON.parse(line); } catch (e) { problems.push(`cards.ndjson line ${at + 1} is not valid JSON`); }
      if (card && card.c !== c.name) problems.push(`cards.ndjson line ${at + 1} is filed under "${card.c}" but its subject in categories.json is "${c.name}"`);
      for (const id of c.lanes || []) note(id, line);
    }
  }
  if (at !== lines.length) problems.push(`categories.json covers ${at} cards but cards.ndjson has ${lines.length} lines`);

  // 2. What each lane SHOULD hold, worked out from the bank's own tags.
  const expected = new Map();
  const wantIn = (id, line) => { if (!expected.has(id)) expected.set(id, new Map()); const m = expected.get(id); m.set(line, (m.get(line) || 0) + 1); };
  const mosLines = new Set();
  for (const q of cards) {
    const line = JSON.stringify({ i: q.id, c: q.category || "(uncategorized)", q: q.q, a: q.boardAnswer || q.a });
    const { ids } = laneIdsOfCard(q, registry);
    for (const id of ids) wantIn(id, line);
    if (ids[0] !== DEFAULT_LANE_ID) mosLines.add(line);
  }

  // 3. The default lane holds no MOS card at all (the opt-in rule) ...
  const inDefault = written.get(DEFAULT_LANE_ID) || new Map();
  for (const line of inDefault.keys()) if (mosLines.has(line)) { problems.push(`the default lane holds an MOS-tagged card: ${line.slice(0, 90)}`); break; }
  // ... and every lane holds exactly what the bank's tags say, card for card.
  for (const id of new Set([...written.keys(), ...expected.keys()])) {
    const got = written.get(id) || new Map(), want = expected.get(id) || new Map();
    if (id !== DEFAULT_LANE_ID && !lanes.some((l) => l.id === id) && want.size === 0) { problems.push(`categories.json puts cards in lane "${id}", which lanes.json does not list`); continue; }
    const n = (m) => [...m.values()].reduce((a, b) => a + b, 0);
    const missing = [...want].filter(([l, k]) => (got.get(l) || 0) < k).length;
    const extra = [...got].filter(([l, k]) => (want.get(l) || 0) < k).length;
    if (missing || extra) problems.push(`lane "${id}": ${n(got)} cards written, the bank's tags say ${n(want)} (${missing} expected card(s) missing, ${extra} unexpected)`);
  }

  // 4. lanes.json describes those same subjects.
  if (!lanes.some((l) => l && l.id === DEFAULT_LANE_ID)) problems.push(`lanes.json has no "${DEFAULT_LANE_ID}" lane - the handheld treats a lanes.json with no default deck as unusable (there would be nothing safe to start on or fall back to but an MOS deck), so nothing is written`);
  else if (lanes[0].id !== DEFAULT_LANE_ID) problems.push("lanes.json must list the default lane first");
  if (new Set(lanes.map((l) => l.id)).size !== lanes.length) problems.push("lanes.json lists the same lane twice");
  for (const l of lanes) {
    const mine = categories.filter((c) => c.lanes.includes(l.id));
    const count = mine.reduce((n, c) => n + c.count, 0);
    if (l.count !== count) problems.push(`lane "${l.id}": lanes.json says ${l.count} cards, its subjects add up to ${count}`);
    if (JSON.stringify(l.categories) !== JSON.stringify(mine.map((c) => c.name))) problems.push(`lane "${l.id}": the subject names in lanes.json are not the ones categories.json puts in it`);
    if (!l.label) problems.push(`lane "${l.id}" has no label`);
  }
  for (const id of registry.decks.map((d) => d.code)) {
    const want = expected.get(id);
    if (want && !lanes.some((l) => l.id === id)) problems.push(`MOS deck ${id} has cards in the bank but no lane in lanes.json`);
  }

  // 5. ... and the lanes add up to the content manifest (the per-category sums
  //    are exportMismatches()'s job, which counts split subjects together).
  const byMos = (manifest.board && manifest.board.byMos) || {};
  for (const id of new Set([...lanes.map((l) => l.id).filter((x) => x !== DEFAULT_LANE_ID), ...Object.keys(byMos)])) {
    const lane = lanes.find((l) => l.id === id);
    const got = lane ? lane.count : 0, want = byMos[id] || 0;
    if (got !== want) problems.push(`MOS deck ${id}: its lane holds ${got} cards, the content manifest says ${want}`);
  }
  const mosCardCount = categories.filter((c) => !c.lanes.includes(DEFAULT_LANE_ID)).reduce((n, c) => n + c.count, 0);
  const def = lanes.find((l) => l.id === DEFAULT_LANE_ID);
  if (def && def.count + mosCardCount !== manifest.totals.board) problems.push(`the default lane (${def.count}) plus the MOS-only cards (${mosCardCount}) is ${def.count + mosCardCount}, the content manifest says ${manifest.totals.board} cards`);
  return problems;
}

/** Every check, the manifest's and the lanes', in one list. */
export function allMismatches(built, cards, registry, fingerprint, manifest) {
  return [...exportMismatches(built.ndjson, built.categories, fingerprint, manifest), ...laneMismatches(built, cards, registry, manifest)];
}
