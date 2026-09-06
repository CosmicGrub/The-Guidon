#!/usr/bin/env python3
"""
Decides whether a Simulator screenshot shows a RENDERED app or a blank WKWebView.

Why this exists rather than a file-size threshold:

    The obvious check is "a flat-colour PNG compresses to almost nothing, so
    fail if the file is under 25 KB." Measured, that threshold is unsafe here.

    A blank screen's PNG size is a function of SCREEN AREA, not of whether the
    app rendered. Measured on this build, a completely blank dark WKWebView is
    7 KB on an iPhone SE, 17 KB on a 16 Pro Max, 20.6 KB on an iPad 10th gen —
    and 28.5 KB on an iPad Pro 12.9", where it sails straight past a 25 KB
    threshold and reports SUCCESS while the app rendered nothing. That is the
    worst possible failure mode for this check, and it appears simply by adding
    a larger iPad to the device matrix.

    Colour variety is resolution-independent and theme-independent, which
    matters because GUIDON ships 14 palettes spanning #ffffff (ink-paper) to
    #000000 (blackout) — no single byte threshold is correct across them.
    Measured: a blank screen scores 1-2 distinct colours, a real GUIDON screen
    scores 853.

    What actually separates the two cases is colour variety. A blank web view is
    one flat colour plus the status bar. A rendered GUIDON screen has text
    antialiasing, borders, an amber accent, and chrome — hundreds to thousands of
    distinct colours — no matter how dark the theme.

Stdlib only (zlib + struct): GitHub's macOS images ship Python 3, but Pillow is
not guaranteed and this must never fail because a dependency was missing.

There is one failure this cannot catch alone, so it does not try: a BRANDED
launch screen has plenty of colour variety, so an app that never progresses past
it would score as "rendered". That is why --compare exists. Screenshot once just
after launch (still the launch screen) and again after the settle, then require
the two frames to DIFFER. A working app moves on; a stuck one shows the same
pixels twice. Together the two checks cover both shapes of the failure:

    blank web view      -> caught by colour variety
    stuck launch screen -> caught by frame equality

"Must differ" is safe even though GUIDON renders a static page, because the two
frames straddle the launch-screen-to-content transition, not two moments of
settled content.

Usage:  png-render-check.py SHOT.png [--min-colors N] [--max-dominant F] [--crop-top N] [--json]
        png-render-check.py --compare EARLY.png LATE.png [--min-diff F] [--json]
Exit:   0 rendered · 1 looks blank / never progressed · 2 could not decode

--crop-top=N drops the top N pixel rows before scoring colour variety and
dominant fraction. A client-area capture (PW_CLIENTONLY, or
CopyFromScreen anchored at ClientToScreen) already excludes the titlebar,
so N is normally 0; the flag exists for a capture path that does include
window chrome, so that path can reuse this same check.
"""
import json
import struct
import sys
import zlib
from collections import Counter

# A blank view is ~1-3 colours (background + status bar text). A rendered screen
# is in the thousands. 64 sits far below any real screen and far above any blank
# one, so it does not need tuning per theme.
DEFAULT_MIN_COLORS = 64
# Even a sparse dark screen leaves under ~99% of pixels as pure background once
# text, rules and the top bar are painted.
DEFAULT_MAX_DOMINANT = 0.995
# Fraction of sampled pixels that must change between the early and late frames.
# A launch-screen-to-content transition changes nearly everything; sensor noise
# is zero in a simulator, so this only needs to clear "identical".
DEFAULT_MIN_DIFF = 0.02


def decode_png(path):
    """Returns (width, height, [(r,g,b), ...]). Raises ValueError on anything
    it cannot decode honestly - never guesses."""
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")

    pos, idat, ihdr = 8, [], None
    while pos + 8 <= len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if ctype == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body[:13])
        elif ctype == b"IDAT":
            idat.append(body)
        elif ctype == b"IEND":
            break
        pos += 12 + length  # length + type + data + crc

    if ihdr is None:
        raise ValueError("no IHDR chunk")
    width, height, depth, color_type, compression, filt, interlace = ihdr
    if depth != 8:
        raise ValueError("unsupported bit depth %d (expected 8)" % depth)
    if interlace != 0:
        raise ValueError("interlaced PNG not supported")
    if color_type not in (2, 6):
        raise ValueError("unsupported colour type %d (expected 2 RGB or 6 RGBA)" % color_type)
    if not idat:
        raise ValueError("no IDAT data")

    channels = 3 if color_type == 2 else 4
    raw = zlib.decompress(b"".join(idat))
    stride = width * channels

    pixels = []
    prev = bytearray(stride)
    at = 0
    for _ in range(height):
        if at >= len(raw):
            raise ValueError("truncated image data")
        ftype = raw[at]
        at += 1
        line = bytearray(raw[at:at + stride])
        at += stride
        if len(line) != stride:
            raise ValueError("truncated scanline")

        # PNG per-scanline filters (RFC 2083 section 6).
        if ftype == 1:      # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:    # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:    # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:    # Paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif ftype != 0:
            raise ValueError("unknown scanline filter %d" % ftype)

        for x in range(0, stride, channels):
            pixels.append((line[x], line[x + 1], line[x + 2]))
        prev = line

    return width, height, pixels


def compare(path_a, path_b, min_diff=DEFAULT_MIN_DIFF):
    """Fraction of pixels differing between two same-size frames."""
    wa, ha, pa = decode_png(path_a)
    wb, hb, pb = decode_png(path_b)
    if (wa, ha) != (wb, hb):
        # Different geometry means something changed, which is the signal we want.
        return 1.0, (wa, ha), (wb, hb)
    if not pa:
        return 0.0, (wa, ha), (wb, hb)
    diff = sum(1 for x, y in zip(pa, pb) if x != y)
    return diff / len(pa), (wa, ha), (wb, hb)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    if not args:
        print("usage: png-render-check.py SHOT.png [--min-colors N] [--max-dominant F] [--json]",
              file=sys.stderr)
        return 2

    if "--compare" in flags:
        if len(args) < 2:
            print("usage: png-render-check.py --compare EARLY.png LATE.png", file=sys.stderr)
            return 2
        min_diff = DEFAULT_MIN_DIFF
        for f in flags:
            if f.startswith("--min-diff="):
                min_diff = float(f.split("=", 1)[1])
        try:
            frac, dim_a, dim_b = compare(args[0], args[1], min_diff)
        except Exception as exc:                   # noqa: BLE001
            print("DECODE-FAIL compare: %s" % exc, file=sys.stderr)
            return 2
        progressed = frac >= min_diff
        report = {
            "early": args[0], "late": args[1],
            "early_size": "%dx%d" % dim_a, "late_size": "%dx%d" % dim_b,
            "changed_fraction": round(frac, 5),
            "min_diff_required": min_diff,
            "verdict": "progressed" if progressed else "stuck",
        }
        if "--json" in flags:
            print(json.dumps(report))
        else:
            print("compare  changed=%.2f%%  ->  %s" % (frac * 100, report["verdict"].upper()))
        return 0 if progressed else 1

    path = args[0]
    min_colors = DEFAULT_MIN_COLORS
    max_dominant = DEFAULT_MAX_DOMINANT
    crop_top = 0
    as_json = "--json" in flags
    for f in flags:
        if f.startswith("--min-colors="):
            min_colors = int(f.split("=", 1)[1])
        elif f.startswith("--max-dominant="):
            max_dominant = float(f.split("=", 1)[1])
        elif f.startswith("--crop-top="):
            crop_top = int(f.split("=", 1)[1])

    try:
        width, height, pixels = decode_png(path)
    except Exception as exc:                       # noqa: BLE001 - report, never crash opaquely
        print("DECODE-FAIL %s: %s" % (path, exc), file=sys.stderr)
        return 2

    if crop_top > 0 and width > 0 and crop_top < height:
        pixels = pixels[crop_top * width:]
        height -= crop_top

    counts = Counter(pixels)
    total = len(pixels) or 1
    dominant_rgb, dominant_n = counts.most_common(1)[0]
    dominant_frac = dominant_n / total

    # The status bar alone paints a handful of colours even over a blank view,
    # so judge on BOTH variety and how much of the screen is one flat colour.
    rendered = len(counts) >= min_colors and dominant_frac <= max_dominant

    report = {
        "file": path,
        "width": width,
        "height": height,
        "distinct_colors": len(counts),
        "dominant_rgb": "#%02x%02x%02x" % dominant_rgb,
        "dominant_fraction": round(dominant_frac, 5),
        "min_colors_required": min_colors,
        "max_dominant_allowed": max_dominant,
        "crop_top": crop_top,
        "verdict": "rendered" if rendered else "blank",
    }

    if as_json:
        print(json.dumps(report))
    else:
        print("%s  %dx%d  colors=%d  dominant=%s %.3f%%  ->  %s" % (
            path, width, height, len(counts), report["dominant_rgb"],
            dominant_frac * 100, report["verdict"].upper()))

    return 0 if rendered else 1


if __name__ == "__main__":
    sys.exit(main())
