/**
 * migrate-citations-wave3: ROADMAP.md item F, Wave 3 - turns the free-text
 * citation strings still living in the static seed (window.GUIDON_SEED in
 * src/index.html) into structured `source: [{pub, edition, para, quoteKind}]`
 * arrays, for every collection listed in WAVE3 (tools/cite-schema.mjs).
 *
 *   node tools/migrate-citations-wave3.mjs            apply (in place)
 *   node tools/migrate-citations-wave3.mjs --check    change nothing; exit 1 if anything is left to migrate
 *   node tools/migrate-citations-wave3.mjs --report   change nothing; print what an apply would do
 *   node tools/migrate-citations-wave3.mjs --seed <path>   act on another copy of index.html
 *
 * WHY THIS FILE STAYS IN THE REPO (a one-time migration usually would not):
 * the seed is ONE ~6 MB line, so git cannot merge two branches that both edit
 * it. This tool is idempotent and works on whatever seed is on disk, so after
 * a conflict is resolved by taking either side's seed line, running it again
 * re-applies exactly this wave's edits on top - and `--check` proves nothing
 * was lost.
 *
 * HOW IT EDITS (the repo rule: scripted, exact-string, count-checked, never
 * re-serialised): the seed text is scanned ONCE with a small JSON walker that
 * records the exact character span of every wanted `"field":value` pair. Each
 * span is verified to parse back to the value the plan expects, then replaced
 * in place; everything else in the file - every byte of the other ~6 MB - is
 * untouched. After all edits the whole seed is parsed again and compared,
 * key order included, against the plan applied to the parsed data. Any
 * mismatch aborts before anything is written; the write itself is a temp
 * file + rename, so a crash cannot leave a half-written index.html.
 *
 * WHAT IT CHANGES, PER RECORD (see tools/cite-schema.mjs for the parser):
 *   - a legacy free-text string becomes a structured array under the key
 *     `source` (the old key - `cite`, `ref`, `reference`, `citation` - is
 *     renamed in place, so key order does not move);
 *   - an empty string ("") drops the key (no citation = no key);
 *   - text the parser cannot confidently classify is kept WHOLE as one entry
 *     whose `pub` is the original wording, so nothing is guessed or lost;
 *   - the text a Soldier reads is unchanged: every parse is verified to
 *     re-render to the original string, character for character.
 * It never touches board.questions (ROADMAP item F Wave 2).
 */
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSeed } from "./seed-io.mjs";
import { WAVE3, parseLegacyCitation, renderCitation } from "./cite-schema.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const argOf = (f) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : null; };

const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The old {ref, para, asOf} object (prt cadenceOverride.source) -> entries. */
function fromLegacyObject(o, where) {
  const extra = Object.keys(o).filter((k) => !["ref", "para", "asOf"].includes(k));
  if (extra.length) throw new Error(`${where}: legacy source object has unexpected keys ${extra.join(", ")}`);
  if (typeof o.ref !== "string" || !o.ref) throw new Error(`${where}: legacy source object has no ref text`);
  if (o.para || o.asOf) throw new Error(`${where}: legacy source object carries para/asOf (${JSON.stringify(o)}) - the migrator only handles the null/null case; extend it deliberately`);
  return parseLegacyCitation(o.ref);
}

/** Every pending edit for this parsed seed. */
export function planMigration(data) {
  const ops = [];
  const how = {};
  for (const site of WAVE3) {
    for (const { owner, path } of site.owners(data)) {
      if (!isObj(owner)) continue;
      const where = `${site.id} ${path.join(".")}`;
      const oldV = owner[site.oldField];
      if (oldV === undefined) continue;
      if (site.oldField === site.field && Array.isArray(oldV)) continue; // already structured
      if (site.oldField !== site.field && owner[site.field] !== undefined) {
        throw new Error(`${where}: has BOTH "${site.oldField}" and "${site.field}" - refusing to guess which wins`);
      }
      let parsed;
      if (site.oldShape === "object") {
        if (!isObj(oldV)) throw new Error(`${where}: expected the legacy {ref,para,asOf} object under "${site.oldField}", found ${typeof oldV}`);
        parsed = fromLegacyObject(oldV, where);
      } else {
        if (typeof oldV !== "string") throw new Error(`${where}: "${site.oldField}" is ${Array.isArray(oldV) ? "an array" : typeof oldV}, expected a legacy string`);
        parsed = oldV === "" ? { entries: [], how: "empty" } : parseLegacyCitation(oldV);
        if (oldV !== "" && renderCitation(parsed.entries) !== oldV) throw new Error(`${where}: parse does not re-render to the original text`);
      }
      ops.push({ siteId: site.id, path, oldField: site.oldField, newField: site.field, oldValue: oldV, entries: parsed.entries, how: parsed.how });
      how[parsed.how] = (how[parsed.how] || 0) + 1;
    }
  }
  return { ops, how };
}

/** Apply the plan to a parsed tree, keeping key order (the equality oracle). */
function applyToTree(data, ops) {
  for (const op of ops) {
    let cur = data;
    for (const k of op.path) cur = cur[k];
    const keys = Object.keys(cur);
    const next = {};
    for (const k of keys) {
      if (k === op.oldField) { if (op.entries.length) next[op.newField] = op.entries; }
      else next[k] = cur[k];
    }
    for (const k of keys) delete cur[k];
    Object.assign(cur, next);
  }
  return data;
}

/** One pass over the JSON text: {pathKey -> {keyStart, valStart, valEnd}} for
 *  every object member whose key is in `lastKeys` AND whose full path is in
 *  `wanted`. Strings are skipped by scanning for the closing quote. */
function locate(raw, wanted, lastKeys) {
  const found = new Map();
  let i = 0;
  const path = [];
  const ws = () => { while (i < raw.length && raw.charCodeAt(i) <= 32) i++; };
  const str = () => { let j = i + 1; for (;;) { const c = raw.charCodeAt(j); if (c === 92) j += 2; else if (c === 34) return j + 1; else j++; } };
  function value() {
    ws();
    const c = raw[i];
    if (c === "{") {
      i++; ws();
      if (raw[i] === "}") { i++; return; }
      for (;;) {
        ws();
        const keyStart = i, kEnd = str();
        const key = JSON.parse(raw.slice(i, kEnd));
        i = kEnd; ws(); i++; ws(); // ':'
        path.push(key);
        const valStart = i;
        value();
        if (lastKeys.has(key)) {
          const pk = JSON.stringify(path);
          if (wanted.has(pk)) found.set(pk, { keyStart, valStart, valEnd: i });
        }
        path.pop();
        ws();
        if (raw[i] === ",") { i++; continue; }
        i++; // '}'
        return;
      }
    } else if (c === "[") {
      i++; ws();
      if (raw[i] === "]") { i++; return; }
      let idx = 0;
      for (;;) {
        path.push(idx++);
        value();
        path.pop();
        ws();
        if (raw[i] === ",") { i++; continue; }
        i++; // ']'
        return;
      }
    } else if (c === '"') { i = str(); }
    else { while (i < raw.length && ",]} \n\r\t".indexOf(raw[i]) === -1) i++; }
  }
  value();
  return found;
}

function buildEdits(raw, ops) {
  const wanted = new Set(ops.map((op) => JSON.stringify([...op.path, op.oldField])));
  const lastKeys = new Set(ops.map((op) => op.oldField));
  const found = locate(raw, wanted, lastKeys);
  const edits = [];
  for (const op of ops) {
    const pk = JSON.stringify([...op.path, op.oldField]);
    const at = found.get(pk);
    if (!at) throw new Error(`could not find ${pk} in the seed text`);
    const keyText = raw.slice(at.keyStart, at.valStart);
    if (!/^"[^"]*"\s*:\s*$/.test(keyText) || JSON.parse(keyText.replace(/\s*:\s*$/, "")) !== op.oldField) throw new Error(`${pk}: the span before the value is ${JSON.stringify(keyText)}, not the "${op.oldField}" key`);
    if (!eq(JSON.parse(raw.slice(at.valStart, at.valEnd)), op.oldValue)) throw new Error(`${pk}: the text at that span is not the value the plan expects`);
    if (op.entries.length) {
      edits.push({ start: at.keyStart, end: at.valEnd, text: JSON.stringify(op.newField) + ":" + JSON.stringify(op.entries), pk });
    } else {
      // Drop the whole `"key":value` pair and exactly one neighbouring comma.
      let s = at.keyStart, e = at.valEnd;
      let j = e; while (j < raw.length && raw.charCodeAt(j) <= 32) j++;
      if (raw[j] === ",") { e = j + 1; while (e < raw.length && raw.charCodeAt(e) <= 32) e++; }
      else { let k = s - 1; while (k >= 0 && raw.charCodeAt(k) <= 32) k--; if (raw[k] === ",") s = k; }
      edits.push({ start: s, end: e, text: "", pk });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  for (let n = 1; n < edits.length; n++) if (edits[n].end > edits[n - 1].start) throw new Error(`overlapping edits at ${edits[n].pk} and ${edits[n - 1].pk}`);
  return edits;
}

export function migrateRaw(raw, data) {
  const { ops, how } = planMigration(data);
  if (!ops.length) return { newRaw: raw, ops, how, edits: [] };
  const edits = buildEdits(raw, ops);
  if (edits.length !== ops.length) throw new Error(`count check failed: ${ops.length} planned edits but ${edits.length} located`);
  let out = raw;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  // The oracle: the edited text must parse to exactly the plan applied to the data.
  const expected = applyToTree(JSON.parse(JSON.stringify(data)), ops);
  const actual = JSON.parse(out);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("verification failed: the edited seed does not equal the plan applied to the parsed seed - nothing written");
  return { newRaw: out, ops, how, edits };
}

function main() {
  const path = argOf("--seed") || fileURLToPath(new URL("../src/index.html", import.meta.url));
  const txt = readFileSync(path, "utf8");
  const { data, raw } = readSeed(path);
  const at = txt.indexOf(raw);
  if (at < 0 || txt.indexOf(raw, at + 1) >= 0) throw new Error("could not place the seed text uniquely inside " + path);
  const { newRaw, ops, how, edits } = migrateRaw(raw, data);

  const bySite = {};
  ops.forEach((op) => { const b = (bySite[op.siteId] = bySite[op.siteId] || { records: 0, removed: 0 }); b.records++; if (!op.entries.length) b.removed++; });
  console.log("migrate-citations-wave3: " + (ops.length ? ops.length + " record(s) pending" : "nothing to migrate (already structured)"));
  Object.keys(bySite).forEach((k) => console.log("  " + k.padEnd(28) + String(bySite[k].records).padStart(4) + " record(s)" + (bySite[k].removed ? " (" + bySite[k].removed + " empty -> key dropped)" : "")));
  if (ops.length) console.log("  parse outcomes: " + JSON.stringify(how));

  if (flag("--report")) return;
  if (flag("--check")) { if (ops.length) { console.log("CHECK FAILED: " + ops.length + " citation(s) still free text"); process.exit(1); } console.log("CHECK OK"); return; }
  if (!ops.length) return;

  const next = txt.slice(0, at) + newRaw + txt.slice(at + raw.length);
  const tmp = `${path}.migrate-${process.pid}-${Date.now()}.tmp`;
  try { writeFileSync(tmp, next, "utf8"); renameSync(tmp, path); }
  finally { if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* best effort */ } } }
  console.log(`  wrote ${path}: ${edits.length} edit(s), ${Buffer.byteLength(next, "utf8") - Buffer.byteLength(txt, "utf8")} bytes net`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, "/").replace(/^([a-z]):/, (m, d) => d.toUpperCase() + ":") || (process.argv[1] || "").endsWith("migrate-citations-wave3.mjs")) main();
