/* ==== js/qrcode.js ==== */
/* GUIDON - qrcode.js : a from-scratch ISO/IEC 18004 QR Code encoder and an
   inline-SVG renderer (G.qrcode). Room-networking pitch, Stage 1.5 ("QR
   render on the host screen") - docs/design/room-tls-and-discovery-pitch.md.

   WHY HAND-ROLLED: this project's own rule (see tools/room-tls.mjs's X.509
   DER encoder, src-tauri/src/room.rs's RFC 6455 framing) is "hand-roll the
   small piece you actually need, don't pull in a library." A QR encoder for
   ONE mode (byte) at ONE error-correction level (M) over a bounded length
   range (a join URL) is exactly that kind of small, self-contained piece -
   no new npm dependency, zero network access, renders entirely client-side
   from a string already in memory.

   SCOPE, DELIBERATELY NARROW:
     - Byte mode ONLY. A join URL (scheme + IPv4 + port + "/j/" + a NATO
       room code) is plain ASCII; alphanumeric/kanji modes would only ever
       shrink the payload a little and are not implemented.
     - Versions 1-10, error-correction level M only. Worked from
       src/app-modules/room-schema.js's own constants: ENDPOINTS.join is
       "/j/", the longest NATO word is "NOVEMBER" (8 chars) so the longest
       room code is "NOVEMBER-NOVEMBER-99" (20 chars), and a LAN origin is
       at most "https://255.255.255.255:65535" (29 chars) - worst case
       ~52 ASCII bytes, comfortably inside version 4-M's 62-byte capacity.
       Versions up to 10 (213 bytes at M) are supported anyway for headroom
       (a future https:// TLS join link, a hostname instead of a bare IP)
       without pretending to support arbitrary-length input: encode()
       returns null, not a partial/wrong code, for anything past version
       10's capacity - see render()'s fallback contract below.
     - "M or better": level M is used unconditionally, which satisfies that
       floor exactly (Q/H would waste modules on inputs this short and buy
       nothing real-world scanning tolerance doesn't already get from M).

   THE ALGORITHM (every one of these is implemented for real below, not
   stubbed - see tools/test-qrcode.mjs for the verification this claim
   rests on):
     1. Mode selection            -> byte mode, mode indicator 0100.
     2. Version/EC-level pick     -> pickVersion(), smallest v in 1..10 at
                                      level M whose data-codeword capacity
                                      fits the input; null (caller falls
                                      back) if none does.
     3. Data encoding + padding   -> buildDataCodewords(): mode + character
                                      count + byte data + terminator + a
                                      byte-boundary pad + 0xEC/0x11 filler
                                      codewords.
     4. Reed-Solomon ECC          -> GF(256) log/antilog tables (primitive
                                      poly 0x11D), a generator-polynomial
                                      builder and a polynomial-division
                                      encoder (rsGeneratorPoly/rsEncode) -
                                      the classic textbook construction,
                                      cross-checked in tools/test-qrcode.mjs
                                      against the widely-published "HELLO
                                      WORLD" version-1-M worked example's
                                      exact 10 EC codeword bytes.
     5. Module placement          -> finder patterns + separators, timing
                                      patterns, alignment patterns (derived
                                      from the version, not a hand-typed
                                      per-version table - see
                                      alignmentPositions()), format
                                      information (both copies, BCH(15,5)),
                                      version information for v>=7
                                      (BCH(18,6) - reachable here since
                                      versions up to 10 are supported), the
                                      fixed dark module, and the zigzag
                                      data/EC codeword bit placement
                                      (placeData()).
     6. Data masking               -> all 8 ISO/IEC 18004 Annex C mask
                                      patterns are generated and penalty-
                                      scored (all four penalty rules); the
                                      lowest-penalty mask is the one kept -
                                      never a hardcoded single pattern.

   FAILS GRACEFULLY, ALWAYS: encode() and render() never throw past their
   own boundary - encode() returns null for anything it cannot represent
   (non-Latin1 text, or text too long for version 10 at level M) and every
   internal step is wrapped so a defensive catch-all still returns null
   rather than letting an unexpected exception reach the caller. render()
   (the DOM-facing entry point src/app-modules/studygroup.js actually
   calls) returns null the same way; the caller's job is to fall back to
   the plain-text join link when it does, exactly as it did before this
   module existed - see drawHostLadder() in studygroup.js.

   Rendering is inline SVG built with document.createElementNS, matching
   this codebase's own existing pattern for drawing shapes (see
   src/app-modules/icons.js's G.icons.el - the only other "draws to
   something" app module) rather than <canvas> (the only <canvas> use in
   this app, src/index.html's on-demand DA-4856 PDF preview, is pixel image
   rendering from pdf.js, a materially different job). SVG also scales to
   any size a joiner's phone camera needs without blurring, which a raster
   canvas would not. The rendered code is fixed black-on-white regardless
   of theme - matching module contrast is what a camera actually reads,
   not what a person finds visually pleasing on screen.

   PRIVACY: takes a string already in memory (the room's own join URL,
   already shown as plain text one line above it) and draws it. No network
   access, no new permission, nothing stored, nothing sent anywhere.

   This file is spliced into every build (tools/build.mjs, alphabetical
   over src/app-modules/*.js - no build.mjs change needed for a new file
   here). It must load with no side effects beyond defining G.qrcode. */
(function (root) {
  "use strict";
  root.G = root.G || {};
  var G = root.G;

  /* ================================================================
     GF(256) arithmetic - primitive polynomial 0x11D (x^8+x^4+x^3+x^2+1),
     the one ISO/IEC 18004 specifies for its Reed-Solomon code.
     ================================================================ */
  var GF_EXP = new Array(512);
  var GF_LOG = new Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();
  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  /* ---------------- Reed-Solomon generator + systematic encoder ---------------- */
  /** g(x) = product_{i=0..degree-1} (x - alpha^i), coefficients HIGHEST-degree
      first (g[0] is the leading, always-1, x^degree coefficient) - the order
      rsEncode's synthetic-division loop below needs, since it walks `data`
      (also highest-degree-first: data[0] is the first byte transmitted) left
      to right. The multiplication loop below naturally builds the product in
      ASCENDING order (constant term first), so the result is reversed once
      at the end to match. */
  function rsGeneratorPoly(degree) {
    var g = [1];
    for (var i = 0; i < degree; i++) {
      var root = GF_EXP[i];
      var next = new Array(g.length + 1);
      for (var j = 0; j < next.length; j++) next[j] = 0;
      for (var j = 0; j < g.length; j++) {
        next[j] ^= gfMul(g[j], root);
        next[j + 1] ^= g[j];
      }
      g = next;
    }
    return g.reverse();
  }
  /** Polynomial long division of data (padded with ecLen zero coefficients)
      by the degree-ecLen generator; the remainder IS the EC codewords. */
  function rsEncode(data, ecLen) {
    var gen = rsGeneratorPoly(ecLen);
    var res = data.concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var factor = res[i];
      if (factor === 0) continue;
      for (var j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], factor);
    }
    return res.slice(data.length);
  }

  /* ================================================================
     Version / block-structure table, error-correction level M only,
     versions 1-10 (ISO/IEC 18004 Table 9 / Annex, level-M column).
     Internally cross-checked (tools/test-qrcode.mjs) against the
     independently well-known total-codewords-per-version sequence
     26,44,70,100,134,172,196,242,292,346: g1n*g1k + g2n*g2k +
     ecPerBlock*(g1n+g2n) must equal that version's total exactly.
     ================================================================ */
  var TABLE_M = {
    1: { ecPerBlock: 10, g1n: 1, g1k: 16, g2n: 0, g2k: 0 },
    2: { ecPerBlock: 16, g1n: 1, g1k: 28, g2n: 0, g2k: 0 },
    3: { ecPerBlock: 26, g1n: 1, g1k: 44, g2n: 0, g2k: 0 },
    4: { ecPerBlock: 18, g1n: 2, g1k: 32, g2n: 0, g2k: 0 },
    5: { ecPerBlock: 24, g1n: 2, g1k: 43, g2n: 0, g2k: 0 },
    6: { ecPerBlock: 16, g1n: 4, g1k: 27, g2n: 0, g2k: 0 },
    7: { ecPerBlock: 18, g1n: 4, g1k: 31, g2n: 0, g2k: 0 },
    8: { ecPerBlock: 22, g1n: 2, g1k: 38, g2n: 2, g2k: 39 },
    9: { ecPerBlock: 22, g1n: 3, g1k: 36, g2n: 2, g2k: 37 },
    10: { ecPerBlock: 26, g1n: 4, g1k: 43, g2n: 1, g2k: 44 },
  };
  var REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };
  var MAX_VERSION = 10;

  function dataCodewordsTotal(v) {
    var t = TABLE_M[v];
    return t.g1n * t.g1k + t.g2n * t.g2k;
  }
  function charCountBits(v) { return v <= 9 ? 8 : 16; }

  /** Smallest version (1..MAX_VERSION) at level M whose byte-mode capacity
      fits byteLen input bytes, or 0 if none does (caller falls back). */
  function pickVersion(byteLen) {
    for (var v = 1; v <= MAX_VERSION; v++) {
      var headerBits = 4 + charCountBits(v);
      var capacityBits = dataCodewordsTotal(v) * 8;
      if (headerBits + byteLen * 8 <= capacityBits) return v;
    }
    return 0;
  }

  /* ---------------- bit writer ---------------- */
  function BitWriter() { this.bits = []; }
  BitWriter.prototype.push = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };
  BitWriter.prototype.toBytes = function () {
    var bytes = [];
    for (var i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      bytes.push(b);
    }
    return bytes;
  };

  /** Mode indicator (0100=byte) + character count + byte data + terminator
      + byte-boundary pad + 0xEC/0x11 filler up to the version's full
      data-codeword capacity. */
  function buildDataCodewords(bytes, v) {
    var bw = new BitWriter();
    bw.push(4, 4);
    bw.push(bytes.length, charCountBits(v));
    for (var i = 0; i < bytes.length; i++) bw.push(bytes[i], 8);
    var capacityBits = dataCodewordsTotal(v) * 8;
    var termLen = Math.max(0, Math.min(4, capacityBits - bw.bits.length));
    if (termLen > 0) bw.push(0, termLen);
    while (bw.bits.length % 8 !== 0) bw.bits.push(0);
    var codewords = bw.toBytes();
    var pad = [0xec, 0x11], pi = 0;
    while (codewords.length < dataCodewordsTotal(v)) { codewords.push(pad[pi % 2]); pi++; }
    return codewords;
  }

  function buildBlocks(dataCodewords, v) {
    var t = TABLE_M[v];
    var blocks = [], idx = 0;
    for (var i = 0; i < t.g1n; i++) { blocks.push(dataCodewords.slice(idx, idx + t.g1k)); idx += t.g1k; }
    for (var i = 0; i < t.g2n; i++) { blocks.push(dataCodewords.slice(idx, idx + t.g2k)); idx += t.g2k; }
    var ecBlocks = [];
    for (var i = 0; i < blocks.length; i++) ecBlocks.push(rsEncode(blocks[i], t.ecPerBlock));
    return { dataBlocks: blocks, ecBlocks: ecBlocks };
  }

  /** Column-major interleave of data codewords across blocks, then EC
      codewords across blocks, then the version's remainder bits. */
  function interleave(dataBlocks, ecBlocks, remainderBits) {
    var bw = new BitWriter();
    var maxData = 0;
    for (var i = 0; i < dataBlocks.length; i++) if (dataBlocks[i].length > maxData) maxData = dataBlocks[i].length;
    for (var i = 0; i < maxData; i++)
      for (var b = 0; b < dataBlocks.length; b++)
        if (i < dataBlocks[b].length) bw.push(dataBlocks[b][i], 8);
    var ecLen = ecBlocks[0].length;
    for (var i = 0; i < ecLen; i++)
      for (var b = 0; b < ecBlocks.length; b++) bw.push(ecBlocks[b][i], 8);
    for (var i = 0; i < remainderBits; i++) bw.bits.push(0);
    return bw.bits;
  }

  /* ================================================================
     Module placement
     ================================================================ */
  function makeMatrix(version) {
    var n = 17 + 4 * version;
    var modules = [], isFunction = [];
    for (var i = 0; i < n; i++) {
      modules.push(new Array(n).fill(false));
      isFunction.push(new Array(n).fill(false));
    }
    return { n: n, modules: modules, isFunction: isFunction, version: version };
  }
  function setFn(g, r, c, val) {
    if (r < 0 || r >= g.n || c < 0 || c >= g.n) return;
    g.modules[r][c] = !!val;
    g.isFunction[r][c] = true;
  }
  /** One 7x7 finder pattern with its 1-module separator, top-left corner (r,c). */
  function drawFinder(g, r, c) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= g.n || cc < 0 || cc >= g.n) continue;
        var dark;
        if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
          var ring = Math.min(dr, dc, 6 - dr, 6 - dc);
          dark = ring !== 1;
        } else {
          dark = false; // separator
        }
        setFn(g, rr, cc, dark);
      }
    }
  }
  function drawTiming(g) {
    for (var i = 0; i < g.n; i++) {
      if (!g.isFunction[6][i]) setFn(g, 6, i, i % 2 === 0);
      if (!g.isFunction[i][6]) setFn(g, i, 6, i % 2 === 0);
    }
  }
  /** Standard derivation (not a hand-typed per-version table): reproduces
      the ISO/IEC 18004 Annex E alignment-position table for every version. */
  function alignmentPositions(v) {
    if (v === 1) return [];
    var n = 17 + 4 * v;
    var numAlign = Math.floor(v / 7) + 2;
    var step = v === 32 ? 26 : Math.floor((v * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
    var result = new Array(numAlign);
    result[0] = 6;
    var pos = n - 7;
    for (var i = numAlign - 1; i >= 1; i--) { result[i] = pos; pos -= step; }
    return result;
  }
  function drawAlignment(g, r, c) {
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var ring = Math.max(Math.abs(dr), Math.abs(dc));
        setFn(g, r + dr, c + dc, ring !== 1);
      }
    }
  }
  function drawAllAlignment(g, v) {
    var pos = alignmentPositions(v);
    var last = pos.length - 1;
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        drawAlignment(g, pos[i], pos[j]);
      }
    }
  }
  /** BCH(15,5) format-info codeword: 2-bit EC level (M=00) + 3-bit mask id,
      then a 10-bit BCH remainder against generator 0x537, XORed with the
      fixed mask 0x5412. */
  function formatBits(ecLevelBits, mask) {
    var data = ((ecLevelBits & 0x3) << 3) | (mask & 0x7);
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
  }
  /** BCH(18,6) version-info codeword (only meaningful for v>=7): 6-bit
      version number + a 12-bit BCH remainder against generator 0x1f25. */
  function versionBits(v) {
    var rem = v;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return ((v << 12) | rem) & 0x3ffff;
  }
  function drawFormat(g, bits) {
    var n = g.n;
    function bit(i) { return ((bits >>> i) & 1) !== 0; }
    // Copy A (wraps the top-left finder): column 8 carries bits 0-7 going
    // down rows 0-5,7,8 (row 6 is the timing track); row 8 carries bits
    // 8-14 going left from column 7 through column 0 (again skipping the
    // timing column). Getting this transposed - row 8 for the low bits,
    // column 8 for the high bits - is a silent, self-consistent-looking
    // bug: every internal check that re-derives the SAME (wrong) mapping
    // still agrees with itself, but a real scanner reading the spec
    // positions gets garbage format info and cannot unmask/decode at all.
    for (var i = 0; i <= 5; i++) setFn(g, i, 8, bit(i));
    setFn(g, 7, 8, bit(6));
    setFn(g, 8, 8, bit(7));
    setFn(g, 8, 7, bit(8));
    for (var i = 9; i < 15; i++) setFn(g, 8, 14 - i, bit(i));
    // Copy B (bottom-left + top-right): row 8 carries bits 0-7 across
    // columns n-1 down to n-8; column 8 carries bits 8-14 up rows n-7
    // through n-1. The fixed dark module is a SEPARATE always-dark cell
    // at (n-8, 8) - not one of the 15 format bits, and not the same cell
    // as (8, n-8) above (row/col are not interchangeable here).
    for (var i = 0; i < 8; i++) setFn(g, 8, n - 1 - i, bit(i));
    for (var i = 8; i < 15; i++) setFn(g, n - 15 + i, 8, bit(i));
    setFn(g, n - 8, 8, true); // fixed dark module
  }
  function drawVersionInfo(g, bits, v) {
    if (v < 7) return;
    function bit(i) { return ((bits >>> i) & 1) !== 0; }
    for (var i = 0; i < 18; i++) {
      var b = bit(i);
      var a = g.n - 11 + (i % 3);
      var bb = Math.floor(i / 3);
      setFn(g, a, bb, b);
      setFn(g, bb, a, b);
    }
  }
  /** Zigzag placement: 2-column strips right-to-left, alternating scan
      direction, skipping the vertical timing column (6). Returns the
      number of stream bits actually consumed (a sanity check). */
  function placeData(g, bitstream) {
    var n = g.n, bi = 0, upward = true;
    for (var col = n - 1; col >= 1; col -= 2) {
      if (col === 6) col--;
      for (var vert = 0; vert < n; vert++) {
        var row = upward ? n - 1 - vert : vert;
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (g.isFunction[row][cc]) continue;
          var v = bi < bitstream.length ? bitstream[bi] : 0;
          g.modules[row][cc] = !!v;
          bi++;
        }
      }
      upward = !upward;
    }
    return bi;
  }

  function cloneModules(modules) {
    var out = new Array(modules.length);
    for (var i = 0; i < modules.length; i++) out[i] = modules[i].slice();
    return out;
  }
  function maskFn(m, r, c) {
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
  function applyMask(g, maskId) {
    var out = cloneModules(g.modules);
    for (var r = 0; r < g.n; r++) {
      for (var c = 0; c < g.n; c++) {
        if (g.isFunction[r][c]) continue;
        if (maskFn(maskId, r, c)) out[r][c] = !out[r][c];
      }
    }
    return out;
  }

  /* ---------------- ISO/IEC 18004 Annex C mask penalty rules ---------------- */
  function penaltyRule1(mods, n) {
    var total = 0;
    for (var dir = 0; dir < 2; dir++) {
      for (var i = 0; i < n; i++) {
        var runColor = -1, runLen = 0;
        for (var j = 0; j < n; j++) {
          var v = dir === 0 ? mods[i][j] : mods[j][i];
          if (v === runColor) {
            runLen++;
          } else {
            runColor = v; runLen = 1;
          }
          if (runLen === 5) total += 3;
          else if (runLen > 5) total += 1;
        }
      }
    }
    return total;
  }
  function penaltyRule2(mods, n) {
    var total = 0;
    for (var i = 0; i < n - 1; i++) {
      for (var j = 0; j < n - 1; j++) {
        var v = mods[i][j];
        if (v === mods[i][j + 1] && v === mods[i + 1][j] && v === mods[i + 1][j + 1]) total += 3;
      }
    }
    return total;
  }
  function penaltyRule3(mods, n) {
    var total = 0;
    var A = [true, false, true, true, true, false, true, false, false, false, false];
    var B = [false, false, false, false, true, false, true, true, true, false, true];
    for (var dir = 0; dir < 2; dir++) {
      for (var i = 0; i < n; i++) {
        for (var j = 0; j + 11 <= n; j++) {
          var mA = true, mB = true;
          for (var k = 0; k < 11; k++) {
            var v = dir === 0 ? mods[i][j + k] : mods[j + k][i];
            if (v !== A[k]) mA = false;
            if (v !== B[k]) mB = false;
          }
          if (mA) total += 40;
          if (mB) total += 40;
        }
      }
    }
    return total;
  }
  function penaltyRule4(mods, n) {
    var dark = 0;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) if (mods[i][j]) dark++;
    var total = n * n;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total);
    return k * 10;
  }
  function penaltyTotal(mods, n) {
    return penaltyRule1(mods, n) + penaltyRule2(mods, n) + penaltyRule3(mods, n) + penaltyRule4(mods, n);
  }

  /* ================================================================
     Public: encode()
     ================================================================ */
  /** Encodes text as a QR symbol (byte mode, level M, versions 1-10).
      Returns { version, size, modules (size x size boolean[][]), mask,
      ecLevel: "M", text } or null when text cannot be represented (a
      non-Latin1 character, or too long for version 10 at level M) - the
      caller's contract is to fall back to a plain-text rendering of the
      same string when this returns null. Never throws. */
  function encode(text) {
    try {
      text = String(text == null ? "" : text);
      var bytes = [];
      for (var i = 0; i < text.length; i++) {
        var code = text.charCodeAt(i);
        if (code > 255) return null; // byte mode only, no UTF-8 multibyte
        bytes.push(code);
      }
      var v = pickVersion(bytes.length);
      if (!v) return null; // too long for any supported version

      var dataCodewords = buildDataCodewords(bytes, v);
      var built = buildBlocks(dataCodewords, v);
      var bitstream = interleave(built.dataBlocks, built.ecBlocks, REMAINDER_BITS[v]);

      var g = makeMatrix(v);
      drawFinder(g, 0, 0);
      drawFinder(g, 0, g.n - 7);
      drawFinder(g, g.n - 7, 0);
      drawTiming(g);
      drawAllAlignment(g, v);
      drawFormat(g, 0); // reserve both format-info copies + dark module
      if (v >= 7) drawVersionInfo(g, 0, v); // reserve both version-info blocks

      var consumed = placeData(g, bitstream);
      if (consumed !== bitstream.length) return null; // placement/table mismatch - refuse rather than ship a wrong code

      var bestMask = 0, bestPenalty = Infinity, bestModules = null;
      for (var m = 0; m < 8; m++) {
        var candidate = applyMask(g, m);
        var pen = penaltyTotal(candidate, g.n);
        if (pen < bestPenalty) { bestPenalty = pen; bestMask = m; bestModules = candidate; }
      }
      var g2 = { n: g.n, modules: bestModules, isFunction: g.isFunction, version: v };
      drawFormat(g2, formatBits(0 /* M */, bestMask));
      if (v >= 7) drawVersionInfo(g2, versionBits(v), v);

      return { version: v, size: g.n, modules: bestModules, mask: bestMask, ecLevel: "M", text: text };
    } catch (e) {
      return null;
    }
  }

  /* ================================================================
     Public: render() - inline SVG, matching src/app-modules/icons.js's
     own createElementNS pattern rather than <canvas>.
     ================================================================ */
  function pathFor(qr, scale, margin) {
    var path = "";
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          var x = (c + margin) * scale, y = (r + margin) * scale;
          path += "M" + x + " " + y + "h" + scale + "v" + scale + "h-" + scale + "z";
        }
      }
    }
    return path;
  }
  /** Renders text as an inline <svg> QR code, or returns null (never
      throws) when it cannot - the caller must fall back to plain text.
      opts: { scale (px per module, default 4), margin (quiet-zone modules,
      default 4), ariaLabel }. */
  function render(text, opts) {
    try {
      var qr = encode(text);
      if (!qr || typeof document === "undefined" || !document.createElementNS) return null;
      opts = opts || {};
      var scale = opts.scale > 0 ? opts.scale : 4;
      var margin = opts.margin != null ? opts.margin : 4;
      var dim = (qr.size + margin * 2) * scale;
      var NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 " + dim + " " + dim);
      svg.setAttribute("width", String(dim));
      svg.setAttribute("height", String(dim));
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", opts.ariaLabel || "QR code for the join link");
      svg.classList.add("sg-qr");
      var bg = document.createElementNS(NS, "rect");
      bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
      bg.setAttribute("width", String(dim)); bg.setAttribute("height", String(dim));
      bg.setAttribute("fill", "#fff");
      svg.appendChild(bg);
      var p = document.createElementNS(NS, "path");
      p.setAttribute("d", pathFor(qr, scale, margin));
      p.setAttribute("fill", "#000");
      svg.appendChild(p);
      return svg;
    } catch (e) {
      return null;
    }
  }

  G.qrcode = {
    encode: encode,
    render: render,
    MAX_VERSION: MAX_VERSION,
    /* Exposed for tools/test-qrcode.mjs only - a Node-side round-trip
       decoder needs the same spec CONSTANTS (GF tables, the RS encoder to
       check syndromes with, the block-structure table, the alignment-
       position formula) an independent reader would also need to hardcode
       itself; it does NOT reuse any placement/masking LOGIC (mask
       formulas, finder/timing/format cell positions, the zigzag scan) from
       this module - those are re-derived from scratch in the test file,
       which is the part the round-trip test actually proves. */
    _internal: {
      gfMul: gfMul, GF_EXP: GF_EXP,
      rsEncode: rsEncode,
      TABLE_M: TABLE_M, charCountBits: charCountBits,
      alignmentPositions: alignmentPositions,
    },
  };
  if (typeof module === "object" && module && module.exports) module.exports = G.qrcode;
})(typeof window !== "undefined" ? window : globalThis);
// END qrcode.js
