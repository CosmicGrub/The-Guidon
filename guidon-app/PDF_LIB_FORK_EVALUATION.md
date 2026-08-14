# Evaluate replacing the vendored pdf-lib bundle (task #248)

**Status: evaluation only — no code changed.** Written 2026-08-13. Findings
below are grounded in a real inspection of this repo's actual vendoring
mechanism and a real download/inspection of the two fork candidates, not
generic advice.

## What's actually vendored, and how

`pdf-lib` is **not** an npm dependency of this project (it appears nowhere in
`package.json`). It's a pre-built, pre-minified UMD bundle
(`pdf-lib.min.js`, sourcemap `pdf-lib.min.js.map`) embedded as a raw
`<script>` block directly inside `src/index.html` itself. `tools/build.mjs`
(the "Extract the PDF stack to sibling files" step, ~line 226) finds that
script by matching the literal string `PDFLib={})` inside it, then extracts
it to `web/assets/pdf-lib.js` / `dist`'s inline copy so it can be lazy-loaded
on demand (`src/pdf-defer.js`) rather than paid for on every page load — a
deliberate ~113ms/900KB boot-time saving (see build.mjs's own comment). This
means there is no `npm install`/lockfile lever to pull here at all — "bump
the dependency" would mean manually re-vendoring a new minified file into
`src/index.html` at the exact same anchor point.

Confirmed the vendored file is the genuine, unmodified output of the original
`Hopding/pdf-lib` project's own build (banner comment, `PDFLib` UMD wrapper
shape, `pdf-lib.min.js.map` sourcemap name all match upstream exactly) — this
project has not hand-patched it.

## Is the original actually unmaintained?

Checked directly: `npm view pdf-lib version` → `1.17.1`, last published
**2021-11-06** — essentially inactive for ~5 years as of this evaluation. No
newer version has shipped since. This confirms the audit's premise.

## Fork candidates investigated

| Fork | Latest version | Last published | Ships a browser UMD bundle? |
|---|---|---|---|
| `@cantoo/pdf-lib` | `2.8.2` | **2026-08-12** (yesterday, relative to this evaluation) | **Yes** — `dist/pdf-lib.min.js`, same `globalThis.PDFLib = {}` UMD wrapper shape as the original (verified by downloading and inspecting the tarball directly) |
| `@pdfme/pdf-lib` | `6.1.12` | 2026-07-23 | Ecosystem-specific fork (built for the `pdfme` template-rendering project); more heavily diverged from upstream's API than cantoo's |

**`@cantoo/pdf-lib` is the realistic candidate.** It positions itself
explicitly as "pdf-lib, but maintained" (adds SVG support and accumulated
fixes on top of the same API surface, per its own README), publishes
continuously, and — critically for THIS project's vendoring mechanism —
ships the same pre-built `dist/pdf-lib.min.js` UMD bundle exposing the same
global, which is the one thing that makes a mechanical swap even possible
without introducing a build step this project doesn't otherwise have.

Size delta: current vendored file is 525,101 bytes;
`@cantoo/pdf-lib@2.8.2`'s equivalent `dist/pdf-lib.min.js` is 696,970 bytes —
**+172KB (+33%)**, presumably from the added SVG-drawing support and several
years of accumulated fixes/features GUIDON's DA 4856 flow doesn't use. Worth
knowing before committing to a swap, though not disqualifying on its own —
the file is already lazy-loaded/deferred and precached by the service worker
(build.mjs's own comment: "measured saving ... for a feature most users never
touch").

## Why I'm not executing this swap

This app's PDF pipeline is exactly the area this session's own history shows
is the most fragile part of the codebase to touch blind. Four separate past
fixes were specifically about pdf-lib's real, sometimes-surprising behavior
under this app's actual field data, not generic library upgrades:

- Task #43 — double-click on the fill button destroyed already-entered data
  (an interaction bug in GUIDON's own code, but surfaced only through how
  pdf-lib's form-fill call actually behaves under rapid re-invocation).
- Task #44 — an emoji or other non-WinAnsi character in a field crashed
  pdf-lib's font-encoding path in a way that looked like a hang rather than a
  clean error, requiring GUIDON to pre-sanitize input before ever calling
  into the library.
- Task #45 — orphaned background PDF generation after the fill modal was
  torn down mid-generation.
- Task #141 — pdf-lib silently dropped field text over some length rather
  than erroring, requiring GUIDON to pre-clamp before the call.

Every one of these was a real, user-facing bug discovered by exercising
pdf-lib's *actual* runtime behavior against real DA 4856 field data — not
something visible from its API surface or changelog. A fork swap is not
guaranteed to preserve every one of these exact behaviors (or their exact
failure modes), even though `@cantoo/pdf-lib` aims for API compatibility.
`tools/test-pdf.mjs` already exercises the generated-PDF byte output (not
just "a button exists"), which is good existing coverage, but it wasn't
written to specifically re-probe these four historical edge cases — it would
need to before a swap could be trusted.

## Recommendation

**Document, don't force it — matches the audit's own framing.** If this is
revisited:

1. Vendor `@cantoo/pdf-lib@2.8.2`'s `dist/pdf-lib.min.js` into
   `src/index.html` at the same `PDFLib={})` anchor, as a scoped experiment
   (e.g. a throwaway branch), not a routine bump.
2. Re-run `tools/test-pdf.mjs` and `tools/test-print-paths.mjs` (and, given
   `src-tauri`/native builds also load this same asset, the desktop/Android
   PDF-export test coverage too) against the swapped bundle.
3. **Specifically re-verify the four historical edge cases above** — an
   emoji/non-WinAnsi field, a rapid double-click fill, an over-length field
   value, and a mid-generation modal teardown — since none of them are things
   a generic "did the tests pass" run would catch by accident; they need
   deliberate re-probing.
4. Compare real byte output on a handful of representative filled DA 4856s
   between the old and new bundle (not just "does it open without erroring")
   — pdf-lib's `PDFDocument.save()` output shape has historically not been
   byte-stable across even its own point releases.
5. Only then consider it a routine, mergeable change.

Given the size of that verification surface relative to the actual benefit
(pdf-lib 1.17.1 has no known CVE against it — it's "unmaintained," not
"actively dangerous" — its risk is bit-rot and missing future PDF features
this app doesn't currently need), this is reasonably deferred rather than
bundled into a routine dependency-hygiene pass.
