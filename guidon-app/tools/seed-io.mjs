/**
 * Shared read/write helper for `window.GUIDON_SEED` — the single JSON blob
 * embedded in src/index.html that carries every piece of GUIDON's app
 * content (doctrine, board.questions, points, forms, finance, career, ...).
 *
 * WHY THIS EXISTS: src/index.html is a ~6MB, ~29k-line HTML document, not a
 * JSON file. The seed itself lives on exactly one line inside it:
 *
 *   window.GUIDON_SEED = {"doctrine":{...},"board":{...},...}
 *
 * Every one-off content-fix agent this session independently re-derived the
 * same "find the marker, find the `=`, find the next newline, trim, strip a
 * trailing `;` if present, JSON.parse it" recipe from scratch in its own
 * prompt, and the mirror-image "re-serialize and splice it back in" recipe
 * for writing. That's exactly the kind of mechanical, error-prone, silently-
 * divergent logic this repo's tools/*.mjs convention exists to make
 * deterministic and shared instead (see build-library-data.mjs's own header
 * for the same rationale applied to a different one-off data-assembly job).
 * This module is that recipe, written once, tested once (test-seed-io.mjs),
 * and reused.
 *
 * DESIGN: rather than trying to parse/reformat the *file* as anything
 * (it isn't JSON, isn't valid as a whole to any parser), this locates the
 * seed assignment textually and treats everything before and after the JSON
 * payload as an opaque byte string to be preserved verbatim. That keeps a
 * writeSeed() call a minimal, single-line diff — exactly the "seed JSON
 * still parses, N insertions/deletions" diffs this session's real
 * content-fix commits show — instead of risking reformatting the other
 * 29,000+ lines of markup and app JS that share this file.
 *
 * SAFETY: writeSeed() never touches the real file until the fully-composed
 * new content has been built in memory AND confirmed to still contain valid
 * JSON at the seed's position. It then writes to a sibling temp file and
 * renames it over the target (a single atomic filesystem operation on both
 * POSIX and Windows), so a crash or thrown error mid-write can never leave
 * src/index.html half-written or truncated — the original file is either
 * fully replaced or untouched, never partially so.
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";

const MARKER = "window.GUIDON_SEED";

/**
 * Locates the seed assignment inside raw HTML text and splits it into three
 * pieces: everything before the JSON payload (`prefix`), the JSON payload
 * itself (`json`), and everything from immediately after the JSON payload
 * through the rest of the file (`suffix`, which includes an optional
 * trailing `;`, any trailing whitespace on that line, the line's newline,
 * and the remaining ~29k lines of the file unchanged).
 *
 * Internal helper shared by readSeed() and writeSeed() so the "where does
 * the seed start/end" logic exists in exactly one place.
 */
function locateSeed(txt, path) {
  const markerIdx = txt.indexOf(MARKER);
  if (markerIdx === -1) {
    throw new Error(`seed-io: could not find "${MARKER}" in ${path} — file may not be GUIDON's src/index.html, or the seed was renamed/removed`);
  }
  const eqIdx = txt.indexOf("=", markerIdx + MARKER.length);
  if (eqIdx === -1) {
    throw new Error(`seed-io: found "${MARKER}" in ${path} but no "=" after it — unexpected file shape`);
  }
  let lineEndIdx = txt.indexOf("\n", eqIdx);
  if (lineEndIdx === -1) lineEndIdx = txt.length; // defensive: marker on the file's last line

  const tail = txt.slice(eqIdx + 1, lineEndIdx);
  const leadingWs = tail.match(/^\s*/)[0];
  const trailingWs = tail.match(/\s*$/)[0];
  const coreEnd = trailingWs.length ? tail.length - trailingWs.length : tail.length;
  let core = tail.slice(leadingWs.length, coreEnd);

  let hadSemicolon = false;
  if (core.endsWith(";")) {
    hadSemicolon = true;
    core = core.slice(0, -1);
  }

  return {
    json: core,
    prefix: txt.slice(0, eqIdx + 1) + leadingWs,
    suffix: (hadSemicolon ? ";" : "") + trailingWs + txt.slice(lineEndIdx),
  };
}

/**
 * Reads and parses `window.GUIDON_SEED` out of src/index.html (or another
 * path with the same shape, e.g. a temp copy used by tests).
 *
 * Returns `{ data, raw, path }`:
 *   - data: the parsed JS object/array tree (doctrine, board, points, ...)
 *   - raw:  the exact JSON text as it appears in the file (no trailing `;`),
 *           useful for byte-level round-trip checks without re-serializing
 *   - path: the path that was read, echoed back for convenience
 *
 * Throws with a clear message if the marker can't be found, or if the text
 * between `=` and the end of that line isn't valid JSON (a corrupted or
 * hand-edited-into-a-bad-state seed) — callers should let this propagate
 * rather than silently continuing with no data.
 */
export function readSeed(path = "src/index.html") {
  const txt = readFileSync(path, "utf8");
  const { json } = locateSeed(txt, path);
  let data;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`seed-io: ${MARKER} in ${path} is not valid JSON (${e.message})`);
  }
  return { data, raw: json, path };
}

/**
 * Serializes `newData` and splices it back into src/index.html (or another
 * path) at the exact position the seed currently occupies, leaving every
 * other byte of the file — everything before `window.GUIDON_SEED = ` and
 * everything after the JSON payload on that line plus the rest of the file
 * — untouched.
 *
 * Order of operations, all before any write happens:
 *   1. Read the CURRENT on-disk content and locate the seed's prefix/suffix
 *      fresh (never trusts a previously-read offset, in case the file
 *      changed since some earlier readSeed() call).
 *   2. JSON.stringify(newData). If this throws (circular reference, BigInt,
 *      etc.) it throws here, before touching the file.
 *   3. Re-parse that string with JSON.parse() to positively confirm it is
 *      valid JSON before it's allowed anywhere near the file — this is the
 *      "must never corrupt the file" guard the caller can rely on.
 *
 * Only once all three checks pass does this write anything, and even then
 * it writes the complete new file content to a temp file first and
 * `renameSync`s it over the target — a single atomic filesystem operation —
 * rather than writing into the original file in place. That means a crash,
 * thrown error, or process kill at any point before the rename leaves
 * src/index.html exactly as it was; there is no window where it can end up
 * half-written.
 *
 * Returns `{ path, bytesWritten }`.
 */
export function writeSeed(newData, path = "src/index.html") {
  const txt = readFileSync(path, "utf8");
  const { prefix, suffix } = locateSeed(txt, path);

  const newJson = JSON.stringify(newData);
  if (typeof newJson !== "string") {
    // JSON.stringify returns `undefined` (not a string, and not a throw) for
    // some inputs — e.g. newData itself being `undefined` or a function.
    // Catch that explicitly rather than let `prefix + undefined + suffix`
    // silently write the literal text "undefined" into the seed.
    throw new Error("seed-io: JSON.stringify(newData) did not produce a string — newData is likely undefined or a function. Aborting; file untouched.");
  }
  try {
    JSON.parse(newJson);
  } catch (e) {
    // Should be unreachable (JSON.stringify's own output is always valid
    // JSON), but this is the explicit "confirm it still parses" guard the
    // caller is promised — fail loudly rather than trust that invariant.
    throw new Error(`seed-io: serialized newData failed to re-parse as JSON (${e.message}). Aborting; file untouched.`);
  }

  const newContent = prefix + newJson + suffix;
  const tmpPath = `${path}.seed-io-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, newContent, "utf8");
    renameSync(tmpPath, path);
  } finally {
    // If writeFileSync succeeded but renameSync threw (e.g. a permissions
    // or cross-device error), don't leave the temp file littering the repo.
    // If renameSync succeeded, tmpPath no longer exists (it WAS the rename
    // source) and this is a harmless no-op guarded by existsSync.
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* best-effort cleanup only */ }
    }
  }

  return { path, bytesWritten: Buffer.byteLength(newContent, "utf8") };
}
