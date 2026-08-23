/**
 * Static pattern lint for GUIDON's three most-repeated bug shapes (full
 * history in GUIDON_MASTERFILE.md, roughly sessions 52-62 - v1.4.0's
 * legibility pass, v1.4.4's 49-agent audit, the follow-up 122-agent sweep).
 * Pure regex/string checks against src/index.html - no browser, no build,
 * runs in milliseconds. Wired in as the FIRST step of `npm test` so a bad
 * pattern fails fast, before any Playwright suite even spins up a browser.
 */
import { readFile } from "node:fs/promises";

const FILE = "src/index.html";
const html = await readFile(FILE, "utf-8");
const lineOf = (idx) => html.slice(0, idx).split("\n").length;

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

console.log("lint-patterns: static regression guard for 3 repeat bug shapes\n");

/* ======================================================================
   (a) Raw accent custom properties (var(--cyan), var(--violet), var(--red),
   var(--green), var(--amber)) used directly as a text `color:` value,
   instead of this project's --ink-* color-mix tokens (or plain var(--text)
   where no color-coding is needed). This exact shape has shipped 28+ times
   across sessions.

   The negative lookbehind below is the whole trick: it matches bare
   `color:` but not `background-color:`, `border-color:`, `outline-color:`,
   etc. - anything preceded by a word character or hyphen is excluded, so
   only the literal text-color property counts. Gradients and box-shadow
   never use the `color:` keyword at all, so they need no separate carve-out.

   BASELINE, not zero-tolerance: the same contrast sweeps that named this
   bug shape also established most raw-accent-as-text usages already in
   this file are NOT bugs - they were individually verified against all 24
   themes and deliberately left alone (one sweep checked 186 candidates and
   confirmed only 18 as real; an earlier one found nine out of a much
   larger set). Mass-converting all of them to --ink-* would itself be
   risky, since --ink-* blends at a different ratio (60/40) than most of
   these hand-tuned spots and nobody has re-verified that swap across every
   theme. So this check is a regression guard: it fails only when the count
   goes UP from the last audited baseline, meaning someone added a NEW raw
   usage without running it past the contrast checker. Known limitation: a
   1-for-1 swap (one fixed, one new one added elsewhere) keeps the count
   flat and slips through - a real gap in any static check standing in for
   a 24-theme render sweep, documented rather than pretended away.
   ====================================================================== */
{
  const styleStart = html.indexOf("<style>");
  const styleEnd = html.indexOf("</style>", styleStart);
  if (styleStart === -1 || styleEnd === -1) {
    bad("(a) could not locate the main <style> block to scan");
  } else {
    const css = html.slice(styleStart, styleEnd);
    const RAW_COLOR = /(?<![\w-])color\s*:\s*var\(--(cyan|violet|red|green|amber)\)/g;
    const hits = [...css.matchAll(RAW_COLOR)];
    const BASELINE = 117; // audited count as of 2026-08-22 (PC parity pass:
    // added .idp-smart-build summary:hover and .promo-coaching
    // summary:hover, both color:var(--amber). test-contrast-full.mjs
    // never simulates :hover so it can't verify these on its own - checked
    // separately via a one-off script that REALLY hovers each selector
    // (Playwright's real synthetic hover, not a class-toggle stand-in) and
    // runs live axe-core color-contrast against it across all 24 themes:
    // .promo-coaching summary (found rendering on #/profile) came back
    // clean, 0 violations across all 24. .idp-smart-build wasn't reachable
    // via a plain route hash to hover directly, but its CSS sets an
    // explicit background:var(--panel) on the .idp-smart-build container
    // itself (not ambient/inherited), and a direct amber-vs-panel contrast
    // check across all 24 themes came back >=5.10:1 in the worst case
    // (WCAG AA floor for this text size is 4.5:1) - safe by the same
    // reasoning, not by direct hover simulation. Three OTHER new
    // color:var(--amber) hover candidates from this same pass
    // (.fin-details/.tx-details/.wr-details summary) were deliberately
    // NOT added here - amber-vs-bg (their ambient, unset-own-background
    // case) came out to 4.46:1 in desert-cadence, just under the 4.5:1
    // floor, so those three use color:var(--text) instead (see each
    // rule's own comment) and never became new raw-accent hits at all.
    // Previously 115 as of 2026-08-15 (rank/MOS upgrade #1: added
    // .roadmap-mechanism summary {color:var(--cyan)}, a small mono-font
    // disclosure label matching the .mode-course .kc-label/.qz-front
    // .kc-label treatment already audited above; re-verified via a fresh
    // test:contrast-full run - 36 routes x 24 themes = 864 combinations, 0
    // violations); 114 earlier the same day (Board Drill upgrade #3), 113
    // as of 2026-08-13 (task #225); see comment above
    if (hits.length > BASELINE) {
      bad(`(a) raw accent color used as text: ${hits.length} found, baseline is ${BASELINE} (+${hits.length - BASELINE} new)`);
      console.log("         first matches (compare against a diff to find the new one(s)):");
      for (const h of hits.slice(0, 15)) {
        console.log(`         line ${lineOf(styleStart + h.index)}: ${h[0]}`);
      }
    } else {
      const note = hits.length < BASELINE ? `, ${BASELINE - hits.length} below baseline - consider lowering BASELINE to lock in the cleanup` : "";
      ok(`(a) raw accent color used as text: ${hits.length} (baseline ${BASELINE}${note})`);
    }
  }
}

/* ======================================================================
   (b) The two touch-target media queries - "@media (pointer: coarse)"
   (bumps controls to 48px for any touchscreen) and "@media (max-width:
   640px)" (guarantees the WCAG 2.5.5 / Apple HIG 44px minimum on narrow
   viewports) - silently drifting apart in which selectors they cover. A
   touch-capable device wider than 640px (tablet, an unfolded foldable in
   landscape) only benefits from the first list; a narrow phone with a
   mouse/trackpad only benefits from the second. When a new touch target is
   added to one list and not the other, it silently loses its minimum size
   on half the device matrix - exactly the shape a prior session's comment
   at the pointer:coarse block already documents having happened once.

   Both blocks are located structurally (brace-matched, not by exact
   whitespace) and, within each, every rule that sets `min-height` is
   unioned into that media condition's selector set - not just the single
   biggest rule - so a same-block companion rule (like `.nav button`'s own
   min-height declaration inside the pointer:coarse block) is still
   counted. Among several `@media (max-width: 640px)` blocks in the file
   (most are small, one-off overrides), the one with the largest min-height
   rule is treated as "the" comprehensive touch-target block for that
   condition - the small ones are unrelated, targeted overrides, not part
   of the shared list this check compares.
   ====================================================================== */
{
  function extractBraceBlock(text, openBraceIdx) {
    let depth = 0;
    for (let i = openBraceIdx; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(openBraceIdx + 1, i); }
    }
    return null;
  }
  function findMediaBlocks(text, conditionRe) {
    const out = [];
    const re = new RegExp(conditionRe.source, "g");
    let m;
    while ((m = re.exec(text))) {
      const braceIdx = text.indexOf("{", m.index);
      if (braceIdx === -1) continue;
      const body = extractBraceBlock(text, braceIdx);
      if (body != null) out.push({ line: lineOf(m.index), body });
    }
    return out;
  }
  function minHeightSelectorsIn(rawBody) {
    // Strip /* ... */ comments first - otherwise a comment sitting between
    // two rules (commas and all) gets swallowed into the next "selector"
    // by the brace-delimited rule regex below and pollutes the set.
    const body = rawBody.replace(/\/\*[\s\S]*?\*\//g, " ");
    const set = new Set();
    let maxLen = 0;
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(body))) {
      const [, selPart, decls] = m;
      if (!/min-height\s*:/.test(decls)) continue;
      const sels = selPart.split(",").map((s) => s.trim()).filter(Boolean);
      sels.forEach((s) => set.add(s));
      if (sels.length > maxLen) maxLen = sels.length;
    }
    return { set, maxLen };
  }
  function comprehensiveTouchTargetSet(text, conditionRe) {
    const blocks = findMediaBlocks(text, conditionRe);
    let best = null;
    for (const b of blocks) {
      const r = minHeightSelectorsIn(b.body);
      if (r.set.size === 0) continue;
      if (!best || r.maxLen > best.maxLen) best = { ...r, line: b.line };
    }
    return best;
  }

  const pointerBest = comprehensiveTouchTargetSet(html, /@media\s*\(\s*pointer:\s*coarse\s*\)\s*/);
  const widthBest = comprehensiveTouchTargetSet(html, /@media\s*\(\s*max-width:\s*640px\s*\)\s*/);

  if (!pointerBest || !widthBest) {
    bad("(b) could not locate one or both touch-target media blocks");
  } else {
    // Documented exceptions: each of these two already gets 44px touch
    // sizing through a DIFFERENT rule than the shared comprehensive list,
    // so their absence from one list is not the "zero enforced minimum"
    // gap this check exists to catch.
    //  - .topbar-search-btn: needs min-width/width/height pinned too (it's
    //    a fixed square icon button), so it has its own dedicated
    //    `@media (max-width:640px){ .topbar-search-btn{...44px} }` rule
    //    instead of living in the shared list.
    //  - .idp-suggest-chip: already carries an unconditional
    //    `min-height:44px` in its base (non-media) rule, so every device -
    //    touch or not - gets at least the WCAG 2.5.5 minimum regardless of
    //    which media list names it.
    const KNOWN_EXCEPTIONS = new Set([".topbar-search-btn", ".idp-suggest-chip"]);

    const onlyInPointer = [...pointerBest.set].filter((s) => !widthBest.set.has(s) && !KNOWN_EXCEPTIONS.has(s));
    const onlyInWidth = [...widthBest.set].filter((s) => !pointerBest.set.has(s) && !KNOWN_EXCEPTIONS.has(s));

    if (onlyInPointer.length || onlyInWidth.length) {
      bad(`(b) touch-target media queries have drifted apart (pointer:coarse @ line ${pointerBest.line}, max-width:640px @ line ${widthBest.line})`);
      if (onlyInPointer.length) console.log("         only in pointer:coarse: " + onlyInPointer.join(", "));
      if (onlyInWidth.length) console.log("         only in max-width:640px: " + onlyInWidth.join(", "));
    } else {
      ok(`(b) touch-target media queries in sync (${pointerBest.set.size} selectors @ line ${pointerBest.line} vs ${widthBest.set.size} @ line ${widthBest.line}; ${KNOWN_EXCEPTIONS.size} documented exception(s) excluded)`);
    }
  }
}

/* ======================================================================
   (c) The old broken title+badge flex-wrap pattern: an inline `style:`
   string combining `justify-content:space-between` with `flex-wrap:wrap`
   on a container holding two children, WITHOUT the fix that keeps them
   from colliding once the row wraps - one child needs flex:1 1 auto /
   min-width:0 (grows, can shrink all the way to nothing so long text
   ellipsizes instead of pushing) and the other needs flex:0 0 auto /
   white-space:nowrap (stays its natural width, never wraps its own text).
   Space-between + wrap without that pairing crowds or overlaps the
   title/badge the moment the row gets tight.

   Every `style:`/`style=` string in the file is scanned for the two
   telltale declarations; when both are present, the next ~700 characters
   of source are checked for the fixed-child pairing. That window covers
   the two child elements that immediately follow the container in this
   codebase's `el(tag, attrs, [children])` builder pattern without being
   so wide it accidentally picks up an unrelated flex rule from further
   down the file.
   ====================================================================== */
{
  const STYLE_STR = /style\s*[:=]\s*(["'`])((?:(?!\1)[\s\S])*)\1/g;
  const hasSpaceBetween = (s) => /justify-content\s*:\s*space-between/.test(s);
  const hasFlexWrap = (s) => /flex-wrap\s*:\s*wrap/.test(s);
  const hasGrowChild = (s) => /flex\s*:\s*1\s+1\s+auto/.test(s) || /min-width\s*:\s*0\b/.test(s);
  const hasFixedChild = (s) => /flex\s*:\s*0\s+0\s+auto/.test(s) || /white-space\s*:\s*nowrap/.test(s);

  let flagged = 0;
  let m;
  while ((m = STYLE_STR.exec(html))) {
    const styleContent = m[2];
    if (!hasSpaceBetween(styleContent) || !hasFlexWrap(styleContent)) continue;
    const windowEnd = Math.min(html.length, m.index + m[0].length + 700);
    const ahead = html.slice(m.index + m[0].length, windowEnd);
    if (!(hasGrowChild(ahead) && hasFixedChild(ahead))) {
      flagged++;
      bad(`(c) space-between+flex-wrap without the fixed child pairing at line ${lineOf(m.index)}`);
      console.log("         " + m[0].slice(0, 140));
    }
  }
  if (flagged === 0) ok("(c) title+badge flex-wrap pattern: 0 unpaired occurrences");
}

/* ======================================================================
   (d) Width-based @media breakpoints drifting off the canonical scale.
   Before Week 4 (2026-08-09), 12 distinct pixel values had accumulated
   across 26 width-based media rules — most were legitimate, deliberately
   spaced device tiers, but two (540px, 560px) were orphaned one-off values
   with no device rationale, independently eyeballed by different feature
   additions and drifting from the dominant 640px touch-target boundary.
   Consolidated to 8 canonical values (see the doc comment above the first
   width-based @media rule in src/index.html, near line 396) and locked in
   here: any new max-width/min-width pixel value outside that set fails,
   so the next stray "some-number-in-the-500s" doesn't silently reopen the
   same drift.

   859/860 -> 799/800 (intuitivism pass, 2026-08-20): the desktop side-rail
   pair moved down 60px so a Tab S9 FE in portrait (~823px, real hardware)
   gets the labeled rail instead of the compact one. See the canonical
   breakpoint scale comment in src/index.html for the full rationale.

   1360 added (PC parity pass, 2026-08-22): Board Drill's 3rd column
   (the readiness pane) needs 96px rail + 80px .main padding + 1160px of
   its own declared minimum = 1336px, rounded up - was gated at 1200px,
   which silently overflowed and rendered invisible on every real desktop
   browser. See the canonical breakpoint scale comment in src/index.html
   for the full measured derivation.

   1500 added (PC/desktop intuitivism pass, Tier 1(e), 2026-08-22):
   Board Drill's icon-only 96px rail had no ceiling - restoring the full
   232px labeled rail costs nothing until 232 + 80 (.main padding) +
   1160 (.drill-layout's own minimum) = 1472px, rounded up. Below that,
   the rail was discarding all 38 nav labels for a card that was never
   at risk of shrinking. See the canonical breakpoint scale comment in
   src/index.html for the full measured derivation.

   `prefers-*`, `hover`, `pointer`, and `print` are feature queries, not
   layout breakpoints, and are intentionally out of scope.
   ====================================================================== */
{
  const CANONICAL = new Set([420, 480, 600, 640, 768, 799, 800, 1024, 1200, 1360, 1500]);
  // Not anchored to a literal "@media" prefix: compound conditions like
  // "@media (min-width: 600px) and (max-width: 859px)" put the second
  // clause after "and (", not "@media (", so anchoring would silently
  // skip it. This parenthesized min/max-width-in-px shape is distinctive
  // enough to media queries that matching it anywhere in the CSS is safe.
  const WIDTH_QUERY = /\(\s*(min-width|max-width)\s*:\s*(\d+)px\s*\)/g;
  const offenders = [];
  const seen = new Set();
  let m;
  while ((m = WIDTH_QUERY.exec(html))) {
    const px = Number(m[2]);
    if (!CANONICAL.has(px)) {
      const key = m.index;
      if (!seen.has(key)) { seen.add(key); offenders.push({ line: lineOf(m.index), px, kind: m[1] }); }
    }
  }
  if (offenders.length) {
    bad(`(d) ${offenders.length} width breakpoint(s) off the canonical scale`);
    for (const o of offenders) console.log(`         line ${o.line}: ${o.kind}: ${o.px}px`);
  } else {
    ok(`(d) all width breakpoints on the canonical scale (${[...CANONICAL].join(", ")})`);
  }
}

console.log("\n" + (fails ? `LINT-PATTERNS: ${fails} FAILURE(S)` : "LINT-PATTERNS: all passed"));
process.exit(fails ? 1 : 0);
