# docs-source/

Real, official source PDFs for GUIDON's Reference Library (`#/library`,
`src/app-modules/library.js`). Fetched directly from armypubs.army.mil (or,
for ADP 6-0, supplied directly by the project owner after the official
listing was briefly unavailable) — never reconstructed from memory. This is
regulation text a Soldier may rely on for an actual promotion board; the
whole point of this feature is that it's the real thing.

## The 15 core publications

| Citation | Title | Source |
|---|---|---|
| ADP 6-0 | Command and Control (July 2026; retitled from "Mission Command") | supplied directly (ARN47032) |
| ADP 6-22 | Army Leadership and the Profession | armypubs.army.mil (ARN42975) |
| ADP 5-0 | The Operations Process | armypubs.army.mil (ARN18126) |
| ADP 7-0 | Training | armypubs.army.mil (ARN40738) |
| AR 350-1 | Army Training and Leader Development | armypubs.army.mil (ARN44161) |
| AR 600-8-19 | Enlisted Promotions and Demotions | armypubs.army.mil (ARN43646) |
| AR 600-9 | The Army Body Composition Program | armypubs.army.mil (ARN43120) |
| AR 600-20 | Army Command Policy | armypubs.army.mil (ARN46266) |
| AR 623-3 | Evaluation Reporting System | armypubs.army.mil (ARN43117) |
| AR 670-1 | Wear and Appearance of Army Uniforms and Insignia | armypubs.army.mil (ARN30302) |
| ATP 6-22.1 | Providing Feedback: Counseling, Coaching, Mentoring | armypubs.army.mil (ARN40232) |
| DA PAM 600-25 | NCO Professional Development Guide | armypubs.army.mil (ARN38811) |
| FM 7-22 | Holistic Health and Fitness | armypubs.army.mil (ARN44522) |
| TC 3-21.5 | Drill and Ceremonies | armypubs.army.mil (ARN32297) |
| TC 3-22.9 | Rifle and Carbine | armypubs.army.mil (ARN19927, C3) |

Selection: the publications GUIDON's own content cites most heavily
(`tools/_staleness_citations_clean.json` — a prior session's citation-
frequency audit), prioritized further by centrality to GUIDON's actual
mission (promotion-board prep, NCO development) over raw count alone. TC
3-25.26 (Map Reading and Land Navigation) was in the original candidate
list but its current edition is CAC-gated on armypubs.army.mil — not
publicly redistributable — so ADP 7-0 (Training) was substituted.

## Regenerating `src/app-modules/library.js`

```
node tools/build-library-data.mjs
```

Re-extracts text from every PDF here via `pdftotext -enc UTF-8` (the `-enc`
flag is load-bearing — its default output encoding on this toolchain is NOT
UTF-8, and every en-dash in a regulation citation like "AR 600–8–19"
silently corrupts into invalid bytes without it), validates the result is
genuinely clean UTF-8, and writes the assembled module. Run this after
adding a document to this folder or replacing one with a newer edition.

**Known exception:** TC 3-22.9 embeds one ballistics formula through a
symbol font whose glyphs are malformed CESU-8 in the source PDF itself —
not an extraction-flag problem, a real defect in that one publication.
`tools/build-library-data.mjs`'s `KNOWN_INVALID_UTF8` set sanitizes
specifically that file (~240 bytes out of 325KB, isolated to the one
formula) rather than failing the whole build on it. Every other document is
expected to extract clean; if a new one doesn't, investigate before adding
it to that set.

## What's NOT here

`ADP_6-0_Mission_Command.pdf`'s filename is a holdover from before the July
2026 edition retitled it "Command and Control" — kept as-is so the citation
id (`adp-6-0`) and file naming stay stable across editions; the *displayed*
title in the app reflects the real current title.

The `*.pdf` files here are copied into `web/docs/` by `tools/build.mjs`
for the web/Android builds only — never into `dist/guidon-standalone.html`.
See `src/app-modules/library.js`'s header comment for why.
