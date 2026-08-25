/**
 * Unit test for tools/seed-io.mjs — the shared readSeed()/writeSeed() helper
 * every content-fix agent used to hand-roll its own (mismatched) version of
 * (see seed-io.mjs's own header for the full rationale).
 *
 * Unlike the rest of this suite, this doesn't launch a browser: seed-io.mjs
 * is pure Node fs/JSON logic with nothing that runs in a page, so there's
 * nothing a browser would add here.
 *
 * Covers, in order:
 *   1. readSeed() against the REAL src/index.html: known content survives
 *      parsing, and JSON.stringify(data) reproduces the extracted raw text
 *      exactly (a strong end-to-end round-trip check on real data).
 *   2. writeSeed() against a TEMP COPY of the file (never the real one):
 *      mutate a field, re-read, confirm the mutation landed, confirm every
 *      byte outside the seed line is unchanged.
 *   3. writeSeed() given data that can't be serialized (a circular
 *      reference): confirms it throws and leaves the temp file byte-for-
 *      byte untouched — the "never corrupt the file" guarantee.
 *   4. Confirms the REAL src/index.html is still byte-identical to how it
 *      started — this test must never actually modify it.
 *
 * The temp copy lives in the OS temp dir (not inside the repo), and is
 * removed in a finally block so it's cleaned up even if an assertion above
 * it throws.
 */
import { readFileSync, copyFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSeed, writeSeed } from "./seed-io.mjs";

const REAL_PATH = "src/index.html";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// Snapshot the real file's exact bytes up front so step 4 can prove this
// test never touched it, regardless of what happens in between.
const realBefore = readFileSync(REAL_PATH, "utf8");

// ── 1. readSeed() against the real file ──────────────────────────────────
const real = readSeed(REAL_PATH);

real.data && typeof real.data === "object"
  ? ok("readSeed() parses window.GUIDON_SEED from the real src/index.html")
  : bad("readSeed() did not return a parsed object");

const bq1 = real.data.board && Array.isArray(real.data.board.questions)
  ? real.data.board.questions.find((q) => q.id === "bq1")
  : null;
bq1 && bq1.q === "What are the seven Army Values?" && bq1.source === "ADP 6-22"
  ? ok('known card "bq1" (Army Values, ADP 6-22) survived parsing intact')
  : bad("known card bq1 missing or changed: " + JSON.stringify(bq1));

Array.isArray(real.data.board.questions) && real.data.board.questions.length > 900
  ? ok(`board.questions has a plausible real count (${real.data.board.questions.length})`)
  : bad("board.questions count looks wrong: " + (real.data.board.questions || []).length);

JSON.stringify(real.data) === real.raw
  ? ok("JSON.stringify(readSeed().data) reproduces the extracted raw text exactly")
  : bad("re-serializing readSeed().data did not reproduce the raw extracted text");

// ── 2. writeSeed() against a temp copy — mutate, re-read, confirm ───────
const tmpPath = join(tmpdir(), `guidon-seed-io-test-${process.pid}-${Date.now()}.html`);
try {
  copyFileSync(REAL_PATH, tmpPath);
  const tmpOriginal = readFileSync(tmpPath, "utf8");

  const { data: before } = readSeed(tmpPath);
  const originalConcept = before.board.questions[0].concept;
  const SENTINEL = "SEED-IO-TEST-SENTINEL " + Date.now();
  before.board.questions[0].concept = SENTINEL;
  const totalCardsBefore = before.board.questions.length;

  const { bytesWritten } = writeSeed(before, tmpPath);
  bytesWritten > 0
    ? ok(`writeSeed() reports bytesWritten (${bytesWritten.toLocaleString()})`)
    : bad("writeSeed() reported zero bytesWritten");

  const { data: after } = readSeed(tmpPath);
  after.board.questions[0].concept === SENTINEL
    ? ok("mutated field landed after writeSeed() + fresh readSeed()")
    : bad("mutation did not land: " + after.board.questions[0].concept);

  after.board.questions.length === totalCardsBefore
    ? ok("board.questions count unchanged by the mutate/write/re-read cycle")
    : bad(`card count changed: ${totalCardsBefore} -> ${after.board.questions.length}`);

  after.board.questions[1] && JSON.stringify(after.board.questions[1]) === JSON.stringify(before.board.questions[1])
    ? ok("an untouched card (index 1) is unchanged")
    : bad("an untouched card changed unexpectedly");

  // Byte-for-byte check on everything OUTSIDE the seed line: locate the
  // marker in both the pre-write temp content and the post-write file, and
  // diff the prefix (before the assignment) and suffix (from the line's
  // newline onward) directly, independent of seed-io's own internals.
  const marker = "window.GUIDON_SEED";
  const tmpAfterRaw = readFileSync(tmpPath, "utf8");
  const idxBefore = tmpOriginal.indexOf(marker);
  const idxAfter = tmpAfterRaw.indexOf(marker);
  const lineEndBefore = tmpOriginal.indexOf("\n", idxBefore);
  const lineEndAfter = tmpAfterRaw.indexOf("\n", idxAfter);

  tmpOriginal.slice(0, idxBefore) === tmpAfterRaw.slice(0, idxAfter)
    ? ok("everything before the seed assignment is byte-for-byte unchanged")
    : bad("content before the seed assignment changed");

  tmpOriginal.slice(lineEndBefore) === tmpAfterRaw.slice(lineEndAfter)
    ? ok("everything after the seed's line (rest of the ~29k-line file) is byte-for-byte unchanged")
    : bad("content after the seed's line changed");

  originalConcept !== SENTINEL
    ? ok("sanity: the mutated field actually had a different original value")
    : bad("sanity check itself was invalid — original value equalled the sentinel");

  // ── 3. writeSeed() with unserializable data must throw and leave the
  // file untouched — the "never corrupt the file" guarantee. ─────────────
  const beforeBadWrite = readFileSync(tmpPath, "utf8");
  const circular = { a: 1 };
  circular.self = circular;
  let threw = false;
  try {
    writeSeed(circular, tmpPath);
  } catch (e) {
    threw = true;
  }
  threw
    ? ok("writeSeed() throws on unserializable data (circular reference) instead of writing garbage")
    : bad("writeSeed() did not throw on a circular reference");

  const afterBadWrite = readFileSync(tmpPath, "utf8");
  afterBadWrite === beforeBadWrite
    ? ok("file is untouched after a writeSeed() call that threw during serialization")
    : bad("file was modified even though writeSeed() threw — corruption risk");

  // No leftover seed-io-internal temp file should survive a failed write.
  const leaked = existsSync(`${tmpPath}.seed-io-${process.pid}`);
  !leaked
    ? ok("no internal temp file leaked after a failed write")
    : bad("an internal temp file was left behind after a failed write");
} finally {
  if (existsSync(tmpPath)) unlinkSync(tmpPath);
}

// ── 4. The real file must be completely untouched by this whole run ─────
const realAfter = readFileSync(REAL_PATH, "utf8");
realAfter === realBefore
  ? ok("the real src/index.html is byte-for-byte unchanged after this test run")
  : bad("the real src/index.html was modified by this test — this must never happen");

console.log("\n" + (fails ? `SEED-IO TEST: ${fails} FAILURE(S)` : "SEED-IO TEST: all passed"));
process.exit(fails ? 1 : 0);
