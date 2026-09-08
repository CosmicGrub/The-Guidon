/**
 * QR code encoder (room-networking pitch, Stage 1.5 - "QR render on the host
 * screen"), Node only - no browser, no build. Mirrors tools/test-room-core.mjs's
 * own structure and PASS/FAIL/INFO convention.
 *
 * HISTORY - why this file imports a real third-party decoder (jsQR) as of
 * the 2026-09 investigation: every code src/app-modules/qrcode.js produced
 * failed to decode with jsQR, a real camera-grade decoder, 100% of the time
 * (a 120-length sweep, every version/mask the encoder reaches), even though
 * this file's own from-scratch decoder (part (c) below) reported a clean
 * round-trip for every single case. Root cause: drawFormat() had the row-8
 * and column-8 format-info runs TRANSPOSED (using bits 0-7 where the ISO
 * spec puts bits 8-14 and vice versa, in both copies) and placed the fixed
 * dark module at the wrong cell entirely. That is a silent, self-consistent
 * bug class: this file's "independent" decoder (buildFunctionMap/
 * readFormatBits below) had been transcribed from the SAME incorrect
 * mental model as the encoder rather than from the spec text itself, so it
 * silently agreed with the encoder's wrong format-info layout instead of
 * catching it - two hand-written implementations sharing no code can still
 * share a human error. "Written fresh in this file, calls no placement
 * function from qrcode.js" is necessary but was NOT sufficient. jsQR is
 * independent in the way that actually matters: different author, tested
 * against real cameras, zero shared assumptions with this codebase. Its
 * decode is now the authoritative check (part (f)); the hand-written
 * decoder below has been corrected to match the true ISO layout and stays
 * as a second, STRICTER check - it requires exact RS syndromes with no
 * error correction, which is more sensitive to a placement bug than jsQR
 * alone (jsQR's own Reed-Solomon error correction can paper over a bug
 * small enough to stay inside the EC budget).
 *
 * What is proved:
 *   (a) The Reed-Solomon engine (GF(256) tables + generator polynomial +
 *       systematic encoder) is checked against the widely-published
 *       "HELLO WORLD" version-1-M worked example's exact 10 EC codeword
 *       bytes - an external, independently-known-correct test vector, not
 *       a self-consistency check.
 *   (b) TABLE_M (the version/block-structure table for EC level M) is
 *       checked against the independently-known total-codewords-per-version
 *       sequence (26, 44, 70, 100, 134, 172, 196, 242, 292, 346).
 *   (c) A from-scratch decoder - written in THIS file, re-deriving the
 *       finder/timing/alignment/format/version function-pattern positions
 *       and the zigzag bit order from the ISO/IEC 18004 spec text (not from
 *       reading qrcode.js) rather than calling any placement/masking
 *       function from src/app-modules/qrcode.js - reads the rendered module
 *       grid back to bytes and confirms EVERY test string round-trips to
 *       the exact original bytes. Covers the shortest and longest realistic
 *       join URLs (worked from room-schema.js's own MAX_* constants and
 *       ENDPOINTS.join), version-capacity boundaries (forces versions
 *       1/2/7/10), and the literal example URL from the task brief.
 *   (d) Reed-Solomon syndromes are all-zero for every clean round trip
 *       (an independent confirmation that the encoded codewords are valid
 *       RS codewords under the standard generator roots, not merely
 *       "decodes because both sides agree") and become non-zero the
 *       instant a single data bit is corrupted (error DETECTION is
 *       verified; full Berlekamp-Massey/Chien/Forney error CORRECTION is
 *       explicitly NOT implemented or claimed here - see the report).
 *   (e) The graceful-fallback contract: encode()/render() return null
 *       (never throw) for a non-Latin1 character and for input far past
 *       version 10's capacity, and render() also returns null with no
 *       throw when no DOM is present.
 *   (f) REAL image-based decode: every module grid encode() produces is
 *       rasterized to a raw RGBA pixel buffer (the same pixels a rendered
 *       <svg> turns into once a camera photographs it - see rasterize()
 *       below) and handed to jsQR, a genuine third-party QR decoder this
 *       project does not author or control. This is the only check in this
 *       file that can catch a bug BOTH src/app-modules/qrcode.js and this
 *       file's own hand-written decoder happen to agree on. Run across a
 *       0-213-byte sweep (every byte length version 10-M can hold).
 *
 * Usage: node tools/test-qrcode.mjs   (exit code = number of FAIL lines)
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import jsQR from "jsqr";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);

console.log("test-qrcode: from-scratch ISO/IEC 18004 encoder (Node only)\n");

/* ---------------------------------------------------------------- load */
try {
  await import(pathToFileURL(resolve("src/app-modules/qrcode.js")).href);
} catch (e) {
  bad("load src/app-modules/qrcode.js: " + e.message.split("\n")[0]);
}
const QR = globalThis.G && globalThis.G.qrcode;
if (!QR) { bad("G.qrcode is not defined after loading src/app-modules/qrcode.js"); finish(); }
const need = ["encode", "render", "MAX_VERSION", "_internal"];
{
  const missing = need.filter((k) => !(k in QR));
  missing.length === 0 ? ok("G.qrcode exposes " + need.join(", ")) : bad("G.qrcode lacks: " + missing.join(", "));
  if (missing.length) finish();
}
const I = QR._internal;

/* ============================================================== (a) RS */
{
  // The canonical "HELLO WORLD" version-1-M worked example (widely
  // published, e.g. the ISO/IEC 18004 tutorial literature): these are the
  // 16 data codewords AFTER alphanumeric-mode encoding + padding, and the
  // 10 EC codewords a correct RS(26,16) encoder must produce from them.
  // Independent of this project's byte-mode-only encoder: it exercises
  // ONLY the GF(256) + generator-polynomial + polynomial-division engine,
  // which is mode-agnostic.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  const expectEC = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23];
  const got = I.rsEncode(data.slice(), 10);
  const match = got.length === expectEC.length && got.every((b, i) => b === expectEC[i]);
  match
    ? ok("(a) rsEncode() reproduces the published HELLO WORLD V1-M EC codewords exactly: [" + got.join(",") + "]")
    : bad("(a) rsEncode(HELLO WORLD data, 10) = [" + got.join(",") + "], expected [" + expectEC.join(",") + "]");
}

/* ======================================================== (b) TABLE_M */
{
  const knownTotals = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };
  let allMatch = true;
  const rows = [];
  for (let v = 1; v <= 10; v++) {
    const t = I.TABLE_M[v];
    const total = t.g1n * t.g1k + t.g2n * t.g2k + t.ecPerBlock * (t.g1n + t.g2n);
    const want = knownTotals[v];
    if (total !== want) { allMatch = false; rows.push(`v${v}: computed ${total} != known ${want}`); }
  }
  allMatch
    ? ok("(b) TABLE_M reproduces the known total-codewords-per-version sequence for v1-10")
    : bad("(b) TABLE_M mismatch: " + rows.join("; "));
}

/* ============================================================ decoder */
// Written fresh here - re-derives the spec-defined function-pattern
// positions and the zigzag scan order independently rather than calling
// any placement/masking function in src/app-modules/qrcode.js. It DOES
// reuse spec constants that any decoder must also hardcode (GF tables,
// TABLE_M, the alignment-position formula) via QR._internal - never
// placement/masking LOGIC, which is what this decoder exists to check.
function maskFnIndependent(m, r, c) {
  switch (m) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
  return false;
}
function buildFunctionMap(n, version) {
  const isFn = [];
  for (let i = 0; i < n; i++) isFn.push(new Array(n).fill(false));
  const mark = (r, c) => { if (r >= 0 && r < n && c >= 0 && c < n) isFn[r][c] = true; };
  const markFinder = (r0, c0) => { for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) mark(r0 + dr, c0 + dc); };
  markFinder(0, 0); markFinder(0, n - 7); markFinder(n - 7, 0);
  for (let i = 0; i < n; i++) { mark(6, i); mark(i, 6); }
  const pos = I.alignmentPositions(version);
  const last = pos.length - 1;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(pos[i] + dr, pos[j] + dc);
    }
  }
  for (let i = 0; i <= 5; i++) mark(i, 8);
  mark(7, 8); mark(8, 8); mark(8, 7);
  for (let i = 9; i < 15; i++) mark(8, 14 - i);
  for (let i = 0; i < 8; i++) mark(8, n - 1 - i);
  for (let i = 8; i < 15; i++) mark(n - 15 + i, 8);
  mark(n - 8, 8);
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3), b = Math.floor(i / 3);
      mark(a, b); mark(b, a);
    }
  }
  return isFn;
}
function readFormatBits(mods) {
  const idx = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
  let bits = 0;
  for (let i = 0; i < 15; i++) bits |= (mods[idx[i][0]][idx[i][1]] ? 1 : 0) << i;
  return (bits ^ 0x5412) >>> 0;
}
function zigzagReadBits(mods, isFn, n) {
  const bits = [];
  let upward = true;
  for (let col = n - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let vert = 0; vert < n; vert++) {
      const row = upward ? n - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (isFn[row][cc]) continue;
        bits.push(mods[row][cc] ? 1 : 0);
      }
    }
    upward = !upward;
  }
  return bits;
}
function bitsToBytes(bits) {
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes.push(b);
  }
  return bytes;
}
function deinterleave(bytes, t) {
  const blockLens = [];
  for (let i = 0; i < t.g1n; i++) blockLens.push(t.g1k);
  for (let i = 0; i < t.g2n; i++) blockLens.push(t.g2k);
  const nBlocks = blockLens.length;
  const maxData = Math.max.apply(null, blockLens);
  const dataBlocks = blockLens.map(() => []);
  let pos = 0;
  for (let i = 0; i < maxData; i++) for (let b = 0; b < nBlocks; b++) if (i < blockLens[b]) dataBlocks[b].push(bytes[pos++]);
  const ecBlocks = blockLens.map(() => []);
  for (let i = 0; i < t.ecPerBlock; i++) for (let b = 0; b < nBlocks; b++) ecBlocks[b].push(bytes[pos++]);
  return { dataBlocks, ecBlocks };
}
function syndromesOf(fullBlock, ecLen) {
  const s = [];
  for (let j = 0; j < ecLen; j++) {
    const x = I.GF_EXP[j];
    let acc = 0;
    for (let i = 0; i < fullBlock.length; i++) acc = I.gfMul(acc, x) ^ fullBlock[i];
    s.push(acc);
  }
  return s;
}
/** Full decode: module grid -> original text. Throws on any inconsistency
    (caller decides pass/fail) rather than guessing. Returns
    { text, maskId, ecLevelBits, syndromesAllZero }. */
function decodeQR(qr) {
  const n = qr.size, version = qr.version;
  if ((n - 17) / 4 !== version) throw new Error("size/version mismatch: n=" + n + " version=" + version);
  const isFn = buildFunctionMap(n, version);
  const raw = readFormatBits(qr.modules);
  const data5 = (raw >>> 10) & 0x1f;
  const maskId = data5 & 0x7;
  const ecLevelBits = (data5 >>> 3) & 0x3;
  if (ecLevelBits !== 0) throw new Error("expected EC level M (00), format info decoded ecLevelBits=" + ecLevelBits);

  const unmasked = [];
  for (let r = 0; r < n; r++) {
    unmasked.push(qr.modules[r].slice());
    for (let c = 0; c < n; c++) {
      if (isFn[r][c]) continue;
      if (maskFnIndependent(maskId, r, c)) unmasked[r][c] = !unmasked[r][c];
    }
  }
  const bits = zigzagReadBits(unmasked, isFn, n);
  const bytes = bitsToBytes(bits);
  const t = I.TABLE_M[version];
  const { dataBlocks, ecBlocks } = deinterleave(bytes, t);

  let syndromesAllZero = true;
  for (let b = 0; b < dataBlocks.length; b++) {
    const full = dataBlocks[b].concat(ecBlocks[b]);
    const s = syndromesOf(full, t.ecPerBlock);
    if (s.some((x) => x !== 0)) syndromesAllZero = false;
  }

  // Reassemble the data-codeword stream (block order, deinterleaved) and
  // parse the byte-mode header.
  let dataCodewords = [];
  for (let b = 0; b < dataBlocks.length; b++) dataCodewords = dataCodewords.concat(dataBlocks[b]);
  const dbits = [];
  for (let i = 0; i < dataCodewords.length; i++) for (let j = 7; j >= 0; j--) dbits.push((dataCodewords[i] >>> j) & 1);
  const readInt = (pos, len) => { let v = 0; for (let i = 0; i < len; i++) v = (v << 1) | dbits[pos + i]; return v; };
  const mode = readInt(0, 4);
  if (mode !== 4) throw new Error("expected byte-mode indicator 0100, got " + mode.toString(2));
  const ccBits = I.charCountBits(version);
  const count = readInt(4, ccBits);
  const chars = [];
  for (let i = 0; i < count; i++) chars.push(readInt(4 + ccBits + i * 8, 8));
  return { text: String.fromCharCode.apply(null, chars), maskId, ecLevelBits, syndromesAllZero };
}

/* ==================================================== (c)/(d) round trip */
{
  // Worked from room-schema.js's own constants: ENDPOINTS.join = "/j/",
  // longest NATO word "NOVEMBER" (8 chars) -> longest room code
  // "NOVEMBER-NOVEMBER-99" (20 chars), longest realistic LAN origin
  // "https://255.255.255.255:65535" (29 chars) -> worst case ~52 bytes.
  const shortest = "http://10.0.0.2:80/j/ALFA-BRAVO-00".replace("ALFA", "ALPHA"); // ~35 bytes, plausible shortest real case
  const longest = "https://255.255.255.255:65535/j/NOVEMBER-NOVEMBER-99"; // 54 bytes, the derived worst case + scheme upgrade headroom
  const fromBrief = "http://192.168.1.42:59331/j/LIMA-WHISKEY-81"; // the literal example in the task brief
  const cases = [
    ["empty string", ""],
    ["single char", "A"],
    ["shortest realistic join URL", shortest],
    ["task-brief example URL", fromBrief],
    ["longest realistic join URL (worst case)", longest],
    ["exact V1-M byte capacity (14 bytes)", "12345678901234"],
    ["V1-M capacity + 1 byte (forces V2)", "123456789012345"],
    ["exact V2-M byte capacity (26 bytes)", "12345678901234567890123456"],
    ["forces version 7 (needs version-info block)", "x".repeat(110)],
    ["forces version 10 (near max capacity)", "y".repeat(210)],
  ];
  for (const [label, text] of cases) {
    try {
      const qr = QR.encode(text);
      if (!qr) { bad(`(c) encode("${label}") unexpectedly returned null`); continue; }
      const decoded = decodeQR(qr);
      const roundTrips = decoded.text === text;
      const okLine = roundTrips && decoded.syndromesAllZero;
      okLine
        ? ok(`(c)/(d) "${label}" (${text.length}b -> v${qr.version}, mask ${qr.mask}): round-trips bit-exact, RS syndromes all zero`)
        : bad(`(c)/(d) "${label}": roundTrips=${roundTrips} syndromesAllZero=${decoded.syndromesAllZero} decodedLen=${decoded.text.length} originalLen=${text.length}`);
    } catch (e) {
      bad(`(c) "${label}" (len ${text.length}): decode threw - ${e.message}`);
    }
  }
}

/* ============================================== (d) RS error detection */
{
  const text = "http://192.168.1.42:59331/j/LIMA-WHISKEY-81";
  const qr = QR.encode(text);
  if (!qr) {
    bad("(d) corruption test: encode() returned null for the setup string");
  } else {
    const clean = decodeQR(qr);
    clean.syndromesAllZero
      ? ok("(d) clean codeword: RS syndromes all zero (valid RS codeword, independently confirmed)")
      : bad("(d) clean codeword unexpectedly had non-zero RS syndromes");
    // Flip one data-region module bit and confirm the syndrome check
    // detects it. Pick a non-function cell deterministically.
    let flipped = false;
    const corrupted = { version: qr.version, size: qr.size, modules: qr.modules.map((row) => row.slice()) };
    const isFn = buildFunctionMap(qr.size, qr.version);
    outer: for (let r = 0; r < qr.size && !flipped; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (isFn[r][c]) continue;
        corrupted.modules[r][c] = !corrupted.modules[r][c];
        flipped = true;
        break outer;
      }
    }
    if (!flipped) {
      bad("(d) corruption test: found no non-function module to flip");
    } else {
      const after = decodeQR(corrupted);
      !after.syndromesAllZero
        ? ok("(d) a single flipped data-region bit is detected: RS syndromes become non-zero")
        : bad("(d) a flipped bit was NOT detected by the RS syndrome check");
      info("(d) NOTE: only error DETECTION (syndromes) is verified here. Full Berlekamp-Massey/" +
        "Chien-search/Forney error CORRECTION is not implemented in src/app-modules/qrcode.js " +
        "or exercised by this test - a scanned code with real damage relies only on whatever " +
        "correction the SCANNING app's own decoder performs, same as any QR code anywhere.");
    }
  }
}

/* ===================================================== (e) fallback */
{
  const tooLong = "z".repeat(3000);
  QR.encode(tooLong) === null
    ? ok("(e) encode() returns null (not a throw, not a truncated code) for input far past version 10 capacity")
    : bad("(e) encode() did not return null for a 3000-byte string");

  const nonLatin1 = "room \u{1F600}"; // emoji -> charCodeAt > 255 (surrogate pair)
  QR.encode(nonLatin1) === null
    ? ok("(e) encode() returns null for a non-Latin1 character rather than mis-encoding it")
    : bad("(e) encode() did not return null for a string containing a non-Latin1 character");

  // render() with no DOM present at all (this Node process has none by
  // default): must return null, not throw.
  let threw = false, r1 = "unset";
  try { r1 = QR.render("http://10.0.0.2:8080/j/ALPHA-BRAVO-42"); } catch (e) { threw = true; }
  (!threw && r1 === null)
    ? ok("(e) render() returns null (no throw) when no DOM is present")
    : bad("(e) render() with no DOM: threw=" + threw + " returned=" + JSON.stringify(r1));

  // Now stub a minimal DOM and confirm render() actually produces an SVG-
  // shaped object whose path draws exactly as many unit squares as there
  // are dark modules in encode()'s own grid, and that it STILL returns
  // null (no throw) for the same too-long / bad-char inputs with a DOM
  // present.
  globalThis.document = {
    createElementNS(ns, tag) {
      return {
        _tag: tag, _ns: ns, _attrs: {}, _kids: [],
        classList: { add() {} },
        setAttribute(k, v) { this._attrs[k] = String(v); },
        appendChild(kid) { this._kids.push(kid); },
      };
    },
  };
  try {
    const text = "http://192.168.1.42:59331/j/LIMA-WHISKEY-81";
    const svg = QR.render(text);
    const qr = QR.encode(text);
    let darkCount = 0;
    for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.modules[r][c]) darkCount++;
    const path = svg && svg._kids[1] && svg._kids[1]._attrs.d;
    const mCount = path ? (path.match(/M/g) || []).length : -1;
    (svg && svg._tag === "svg" && svg._ns === "http://www.w3.org/2000/svg" && mCount === darkCount)
      ? ok(`(e) render() with a DOM present produces an <svg> whose path draws exactly the ${darkCount} dark modules encode() reports`)
      : bad(`(e) render() with DOM: tag=${svg && svg._tag} mCount=${mCount} darkCount=${darkCount}`);
  } catch (e) {
    bad("(e) render() with a DOM present threw: " + e.message);
  }
  try {
    QR.render("z".repeat(3000)) === null
      ? ok("(e) render() still returns null (no throw) for a too-long string even with a DOM present")
      : bad("(e) render() did not return null for a too-long string with a DOM present");
  } catch (e) {
    bad("(e) render() threw for a too-long string with a DOM present: " + e.message);
  }
  delete globalThis.document;
}

/* ================================================ (f) real image decode */
// Rasterizes encode()'s module grid to a raw RGBA pixel buffer - the same
// black/white pixels a rendered <svg> becomes once a camera photographs
// it - and hands that buffer to jsQR, a real third-party QR decoder this
// project neither authors nor controls. This is the check that actually
// caught the 2026-09 bug (see the file header): both src/app-modules/
// qrcode.js and this file's own hand-written decoder above independently
// agreed on a wrong format-info layout, so only a decoder with zero shared
// provenance could expose it.
function rasterize(qr, scale, margin) {
  scale = scale || 6; margin = margin == null ? 4 : margin;
  const dim = (qr.size + margin * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.modules[r][c]) continue;
      const x0 = (c + margin) * scale, y0 = (r + margin) * scale;
      for (let y = y0; y < y0 + scale; y++) {
        for (let x = x0; x < x0 + scale; x++) {
          const i = (y * dim + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    }
  }
  return { data, dim };
}
{
  // Every byte length version 10-M can hold (pickVersion's whole reachable
  // range), plus 0 - not a handful of cherry-picked cases: the original
  // bug was a 100% failure rate across every version/mask the encoder
  // reaches, and only a sweep this wide would have caught it reliably.
  let pass = 0, failLines = [];
  for (let len = 0; len <= 213; len++) {
    const text = "x".repeat(len);
    const qr = QR.encode(text);
    if (!qr) { failLines.push(`len=${len}: encode() unexpectedly returned null`); continue; }
    const { data, dim } = rasterize(qr);
    const result = jsQR(data, dim, dim);
    if (result && result.data === text) pass++;
    else failLines.push(`len=${len} (v${qr.version} mask${qr.mask}): jsQR ${result ? "decoded " + JSON.stringify(result.data) : "FAILED to decode"}`);
  }
  failLines.length === 0
    ? ok(`(f) jsQR decodes every byte length 0-213 (all versions 1-10 at level M) back to the exact original text`)
    : bad(`(f) jsQR sweep: ${failLines.length}/214 failed - ` + failLines.slice(0, 5).join("; ") + (failLines.length > 5 ? ` ... (+${failLines.length - 5} more)` : ""));

  // The literal task-brief URL and a couple of realistic join links too -
  // uniform "x" repeats alone wouldn't catch a bug tied to specific byte
  // values (e.g. a mask chosen differently for structured vs. uniform data).
  const realistic = [
    "http://192.168.1.42:59331/j/LIMA-WHISKEY-81",
    "https://255.255.255.255:65535/j/NOVEMBER-NOVEMBER-99",
    "http://10.0.0.2:80/j/ALPHA-BRAVO-00",
  ];
  for (const text of realistic) {
    const qr = QR.encode(text);
    if (!qr) { bad(`(f) encode("${text}") unexpectedly returned null`); continue; }
    const { data, dim } = rasterize(qr);
    const result = jsQR(data, dim, dim);
    (result && result.data === text)
      ? ok(`(f) jsQR decodes realistic join URL "${text}" (v${qr.version} mask${qr.mask}) exactly`)
      : bad(`(f) jsQR on "${text}": ` + (result ? "decoded " + JSON.stringify(result.data) : "FAILED to decode"));
  }
}

/* ============================================== defensive-input sweep */
{
  const weird = [null, undefined, 0, 42, {}, [], true];
  let anyThrew = false;
  for (const w of weird) {
    try { QR.encode(w); QR.render(w); } catch (e) { anyThrew = true; info("(sweep) input " + JSON.stringify(w) + " threw: " + e.message); }
  }
  !anyThrew
    ? ok("(sweep) encode()/render() never throw on null/undefined/number/object/array/boolean input")
    : bad("(sweep) encode()/render() threw on at least one non-string input (see INFO lines above)");
}

finish();

function finish() {
  console.log("\n" + (fails ? `QRCODE: ${fails} FAILURE(S)` : "QRCODE: all passed"));
  process.exit(fails ? 1 : 0);
}
