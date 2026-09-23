/**
 * One-time (re-)generator for the AFT event scoring breakpoint arrays baked
 * into src/app-modules/aft-scoring.js's TABLES object.
 *
 * Source of truth: tools/aft-source-tables/{mdl,hrp,sdc,plk,tmr}.txt - each
 * a verbatim, row-per-line transcription of the official "Army Fitness Test
 * Score Tables" (Approved 15 May 2025, Effective 1 June 2025), downloaded
 * from https://www.army.mil/e2/downloads/rv7/aft/AFT_Scoring_Scales_250601.pdf
 * (linked from army.mil/aft as "AFT Scoring Tables (Effective June 1,
 * 2025)"). Each row is: <points> <20 values> where the 20 values are, for
 * each of the 10 published age bands (17-21, 22-26, 27-31, 32-36, 37-41,
 * 42-46, 47-51, 52-56, 57-61, 62+, in that order), the "M | C" column value
 * then the "F" column value. A cell the source table prints as "---" (no
 * raw value earns exactly that integer points value at that age/sex/event)
 * is written as the literal token "---" and is dropped, not guessed.
 *
 * Run: node tools/gen-aft-tables.mjs
 * It prints the TABLES object body (the "mdl: {...}, hrp: {...}, ..." block)
 * to stdout. Paste that in place of the existing block in
 * src/app-modules/aft-scoring.js's `var TABLES = { ... };` if the Army
 * publishes a revised scoring table and the source .txt files above are
 * updated to match. This script also throws if any column's points are not
 * strictly descending (a transcription-order sanity check), so a bad paste
 * into the .txt source files fails loudly here rather than silently
 * shipping a wrong lookup.
 */
import { readFileSync } from "node:fs";

const BANDS = ["17-21", "22-26", "27-31", "32-36", "37-41", "42-46", "47-51", "52-56", "57-61", "62+"];

function toSeconds(tok) {
  const m = /^(\d+):(\d{2})$/.exec(tok);
  if (!m) throw new Error("bad time token: " + tok);
  return (+m[1]) * 60 + (+m[2]);
}

function parseFile(path, isTime) {
  const lines = readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const bandsM = BANDS.map(() => []);
  const bandsF = BANDS.map(() => []);
  for (const line of lines) {
    const tok = line.split(/\s+/);
    const pts = parseInt(tok[0], 10);
    const vals = tok.slice(1, 21);
    if (vals.length !== 20) throw new Error("line does not have 20 values: " + line);
    for (let b = 0; b < 10; b++) {
      const mTok = vals[b * 2];
      const fTok = vals[b * 2 + 1];
      if (mTok !== "---") bandsM[b].push([pts, isTime ? toSeconds(mTok) : parseInt(mTok, 10)]);
      if (fTok !== "---") bandsF[b].push([pts, isTime ? toSeconds(fTok) : parseInt(fTok, 10)]);
    }
  }
  return { M: bandsM, F: bandsF };
}

function fmtCol(col) {
  return "[\n" + col.map((rows) => "      [" + rows.map((r) => "[" + r[0] + "," + r[1] + "]").join(",") + "]").join(",\n") + "\n    ]";
}

const events = [
  ["mdl", "tools/aft-source-tables/mdl.txt", false],
  ["hrp", "tools/aft-source-tables/hrp.txt", false],
  ["sdc", "tools/aft-source-tables/sdc.txt", true],
  ["plk", "tools/aft-source-tables/plk.txt", true],
  ["tmr", "tools/aft-source-tables/tmr.txt", true]
];

let out = "";
for (const [key, path, isTime] of events) {
  const data = parseFile(path, isTime);
  out += "  " + key + ": { M: " + fmtCol(data.M) + ", F: " + fmtCol(data.F) + " },\n";
  for (const col of ["M", "F"]) {
    data[col].forEach((rows, bi) => {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] >= rows[i - 1][0]) throw new Error(key + " " + col + " band " + bi + ": points not strictly descending at " + JSON.stringify(rows[i - 1]) + " -> " + JSON.stringify(rows[i]));
      }
    });
  }
}
process.stdout.write(out);
