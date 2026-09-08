/**
 * Static pattern lint for GUIDON's most-repeated bug shapes (full history in
 * GUIDON_MASTERFILE.md, roughly sessions 52-62 - v1.4.0's legibility pass,
 * v1.4.4's 49-agent audit, the follow-up 122-agent sweep; (e) added
 * 2026-09 alongside the Guided Tour's Highlights track).
 * Pure regex/string checks against src/index.html - no browser, no build,
 * runs in milliseconds. Wired in as the FIRST step of `npm test` so a bad
 * pattern fails fast, before any Playwright suite even spins up a browser.
 */
import { readFile, readdir } from "node:fs/promises";
import { MODE_TEXT } from "./dismiss-onboarding.mjs";

const FILE = "src/index.html";
const html = await readFile(FILE, "utf-8");
const PKG = JSON.parse(await readFile("package.json", "utf-8"));

/* --tools-dir=<path> (or --tools-dir <path>) overrides which directory
   check (e) scans below, for mutation-testing the check itself against a
   scratch copy without touching the real tools/ tree. Defaults to "tools". */
const argv = process.argv.slice(2);
function argVal(name) {
  const eq = argv.find((a) => a.startsWith("--" + name + "="));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.indexOf("--" + name);
  if (idx !== -1 && argv[idx + 1] !== undefined) return argv[idx + 1];
  return null;
}
const TOOLS_DIR = argVal("tools-dir") || "tools";
const lineOf = (idx) => html.slice(0, idx).split("\n").length;

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

console.log("lint-patterns: static regression guard for repeat bug shapes and release hygiene\n");

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
    const BASELINE = 119; // audited count as of 2026-08-23 (Rapid Fire,
    // Stage 1: added .rf-card .kc-label and .rf-answer-label, both
    // color:var(--cyan) - the SAME mono-uppercase-label-on-var(--panel)
    // treatment .qz-front .kc-label already uses (already inside this
    // baseline), just under new selectors for Rapid Fire's own round-
    // screen markup. Both sit on an explicit background:var(--panel)
    // (.rf-card's own, not ambient/inherited - .rf-answer-panel has no
    // background of its own, so it inherits .rf-card's), the identical
    // combination already covered by test-contrast-full.mjs's existing
    // sweep of .qz-front .kc-label - not a new contrast question, a new
    // selector for an already-audited one. .rf-timer's amber/red (the
    // OTHER two new color spots on this same screen) are deliberately set
    // via JS (updateHud(), src/index.html) instead of a static CSS rule,
    // so they never became new hits here at all - see that function's own
    // comment for the contrast reasoning (large bold text, 3:1 floor).
    // Previously 117 as of 2026-08-22 (PC parity pass:
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

/* ======================================================================
   (e) The old onboarding-dismissal idioms, over tools/*.mjs. Originally
   written against the single "guest session" mode-card text; round-3 of
   the onboarding-migration work generalized every clause below that used
   to hard-code /guest session/i so it instead matches ANY of the real
   onboarding mode-select cards ("Personal Account" / "Guest Session" /
   "Kiosk / Demo Mode" - src/index.html's renderModeStep()). Those texts
   are read from tools/dismiss-onboarding.mjs's own exported MODE_TEXT map
   (imported at the top of this file) rather than hand-copied here, so
   there remains exactly one place these strings live - see that module's
   own comment on MODE_TEXT for why.

   Re-check 2026-09-05 follow-up: tools/test-nav-tier1.mjs's flake fix
   replaced a fixed `waitForTimeout(700)` before an in-page `evaluate()`
   click with a real Playwright locator wait, but the fix only landed in
   that one suite. A number of other tools/test-*.mjs suites and
   tools/*.mjs harnesses still carry one of several shapes of the old,
   un-migrated idiom, or a local reimplementation of the fix that never
   imports the shared tools/dismiss-onboarding.mjs helper:

     (i)   a `waitForTimeout(` call within 3 source lines before an
           `evaluate(` call whose body matches a mode-card text - the
           original timed-then-blind-click shape;
     (ii)  any `evaluate(` body that both matches a mode-card text and
           calls `.click(` on something inside the page - the same shape
           however it's spaced, including outside an adjacent
           waitForTimeout;
     (iii) a local `function`/`const` named `pastOnboarding` or
           `dismissOnboarding` that does not import the shared helper from
           "./dismiss-onboarding.mjs" - a hand-rolled copy (even the
           locator-based kind) that can silently drift from the shared
           fix, including the shared fix's own throw-loudly behavior;
     (iv)  a Playwright LOCATOR (not evaluate()) built against a mode-card
           text - via `hasText`, a chained `.filter()` with that regex, or
           a `text=` selector containing it - followed within a short
           window by a `.waitFor(...)` call whose result is piped straight
           into `.catch(...)`. That trailing `.catch(` is the tell: it
           swallows a missing/slow mode card instead of surfacing it, so a
           real regression sails past this wait and fails three lines
           later on an unrelated-looking click/timeout instead of here,
           with a diagnosable message. This is the shape
           tools/test-nav-tier1.mjs's own 2026-09-05 flake fix landed with
           (both its dismissal sites still end in `.catch(() => {})`) and
           the one tools/dismiss-onboarding.mjs itself was built to
           replace;
     (v)   the same underlying bug as (iv) with no wait at all: a
           `waitForTimeout(` call, followed within a short window by a
           mode-card LOCATOR, followed by an `if (await <var>.count())` (or
           equivalent inline `.count()` check) with NO `.waitFor(` call
           anywhere in between. A blind fixed delay stands in for a real
           wait, and a falsy `.count()` is treated as a legitimate "already
           past onboarding" outcome instead of a miss worth surfacing - so
           a genuinely missing/slow mode card is silently skipped rather
           than thrown.

   tools/dismiss-onboarding.mjs itself is exempt (it IS the shape (iii)
   is checking for the absence of an import of, and its own fallback
   locator + try/catch is the correct, throw-loudly replacement for (iv)
   and (v), not another instance of either).

   Adversarial-sweep follow-up (2026-09-05): matching ANY_MODE_RE against
   the ENTIRE text of an evaluate()/locator() call (rather than against the
   specific piece of it that actually selects a card) produced false
   positives once the mode texts were generalized beyond "guest session" -
   a bare word like "kiosk" or the phrase "personal account" also occurs in
   code that has nothing to do with picking an onboarding mode card (an
   aria-label on an unrelated settings toggle; the .ob-kiosk-card class used
   by the in-app #/kiosk route's own, unrelated tour content). (i)/(ii) now
   additionally require the .ob-mode-card class itself appear in the
   evaluate() body; (iv)/(v)'s shared matchModeLocatorEnd() now only counts
   a mode text that sits inside an actual hasText/name OPTION value, not one
   that merely appears somewhere in the locator call's arguments.
   ====================================================================== */
{
  // This codebase's prose comments are dense and lean on contractions
  // ("it's", "wasn't", "Soldier's"). Scanning raw source for paren balance
  // or for /guest session/i would let a stray apostrophe in a comment
  // desync paren counting, or let a comment that merely TALKS ABOUT the
  // idiom (rather than containing it in real code) count as a hit. Every
  // file is sanitized once - comment interiors blanked to spaces/newlines,
  // string/template literal contents left untouched (so a real
  // `/guest session/i` regex literal or "guest session" string still
  // matches) - before any of the checks below run. Blanking preserves
  // exact character offsets and line breaks, so line numbers computed
  // against the sanitized text are identical to the original file's.
  function stripComments(text) {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const c = text[i], c2 = text[i + 1];
      if (c === "/" && c2 === "/") {
        while (i < text.length && text[i] !== "\n") { out += " "; i++; }
        continue;
      }
      if (c === "/" && c2 === "*") {
        out += "  "; i += 2;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) { out += (text[i] === "\n" ? "\n" : " "); i++; }
        if (i < text.length) { out += "  "; i += 2; } else break;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        out += c; i++;
        while (i < text.length && text[i] !== quote) {
          if (text[i] === "\\" && i + 1 < text.length) { out += text[i] + text[i + 1]; i += 2; continue; }
          out += text[i]; i++;
        }
        if (i < text.length) { out += text[i]; i++; }
        continue;
      }
      out += c; i++;
    }
    return out;
  }

  function extractParenBlock(codeOnly, openParenIdx) {
    let depth = 0;
    for (let i = openParenIdx; i < codeOnly.length; i++) {
      const c = codeOnly[i];
      if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        i++;
        while (i < codeOnly.length && codeOnly[i] !== quote) { if (codeOnly[i] === "\\") i++; i++; }
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) return codeOnly.slice(openParenIdx + 1, i); }
    }
    return null;
  }

  // Same brace/quote-aware matching as extractParenBlock, but also returns
  // where the call's closing ")" sits - needed by (iv) below to look at what
  // comes immediately AFTER a locator/filter/waitFor call (a chained
  // .filter(...) or a trailing .catch(...)), not just the call's own body.
  function extractParenSpan(codeOnly, openParenIdx) {
    let depth = 0;
    for (let i = openParenIdx; i < codeOnly.length; i++) {
      const c = codeOnly[i];
      if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        i++;
        while (i < codeOnly.length && codeOnly[i] !== quote) { if (codeOnly[i] === "\\") i++; i++; }
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) return { body: codeOnly.slice(openParenIdx + 1, i), end: i + 1 }; }
    }
    return null;
  }

  // ANY of the real onboarding mode-card texts, read from
  // tools/dismiss-onboarding.mjs's own MODE_TEXT map - not hand-copied here.
  const ANY_MODE_RE = new RegExp(Object.values(MODE_TEXT).map((re) => re.source).join("|"), "i");
  // Bare mode-text words (kiosk, personal account, ...) also show up inside
  // unrelated code that has nothing to do with picking an onboarding mode
  // card: an aria-label string on an unrelated settings toggle, or a CSS
  // class name for a DIFFERENT element (.ob-kiosk-card, the in-app #/kiosk
  // route's own tour-content class, unrelated to the .ob-mode-card picker).
  // Requiring the real card class alongside the mode text (for evaluate()
  // bodies) or requiring the mode text sit specifically inside a hasText/name
  // OPTION value (for locators) - rather than matching ANY_MODE_RE anywhere
  // in the surrounding text - is what actually distinguishes "this code
  // selects an onboarding mode card" from "this code happens to mention the
  // same word".
  const MODE_CARD_CLASS_RE = /ob-mode-card/;
  const OPTION_VALUE_RE = /\b(?:hasText|name)\s*:\s*(\/(?:\\.|[^/\n])*\/[a-z]*|"(?:\\.|[^"\n])*"|'(?:\\.|[^'\n])*')/g;
  function optionValues(argsText) {
    const vals = [];
    OPTION_VALUE_RE.lastIndex = 0;
    let mm;
    while ((mm = OPTION_VALUE_RE.exec(argsText))) vals.push(mm[1]);
    return vals;
  }
  const CLICK_RE = /\.click\s*\(/;
  const FUNC_DECL_RE = /\b(?:async\s+function\s+|function\s+|const\s+)(pastOnboarding|dismissOnboarding)\b\s*[=(]/g;
  const IMPORT_HELPER_RE = /from\s*["'](?:\.\/)?dismiss-onboarding\.mjs["']/;
  const LOCATOR_RE = /\.locator\s*\(/g;
  const WAITFOR_RE = /\.waitFor\s*\(/g;
  const WAITFOR_TEST_RE = /\.waitFor\s*\(/; // non-global: safe for a plain .test()
  const COUNT_RE = /\.count\s*\(/;
  const CATCH_IMMEDIATELY_AFTER_RE = /^\s*\.catch\s*\(/;
  const LOCATOR_WAITFOR_WINDOW = 400; // chars of lookahead from the end of a
  // mode-card locator (plus any chained .filter()) to find its
  // .waitFor(...).catch(...) - covers the real shape (locator declared, then
  // `.waitFor({...}).catch(() => {})` on the same or very next statement)
  // without reaching far enough to pick up an unrelated later waitFor.

  // Shared by (iv) and (v): does the `.locator(...)` call opening at
  // `openIdx` (optionally plus an immediately-chained `.filter(...)`) select
  // one of the onboarding mode cards? Returns the index just past the
  // matched call/chain on a match, else null. One matcher, not a copy per
  // clause - see the round-3 rule against parallel copies.
  function matchModeLocatorEnd(text, openIdx) {
    const span = extractParenSpan(text, openIdx);
    if (!span) return null;
    // Only a mode text sitting inside a hasText/name OPTION value counts -
    // not a mode word appearing anywhere in the call (e.g. embedded as
    // literal text inside an unrelated CSS attribute selector string, which
    // is not "selecting a mode card via hasText" at all).
    if (optionValues(span.body).some((v) => ANY_MODE_RE.test(v))) return span.end;
    // Not matched directly (e.g. selector alone, hasText via a chained
    // .filter() instead) - check for an immediately-chained
    // .filter({ hasText: <mode re> }) / .filter({ ... }, re).
    const tail = text.slice(span.end, span.end + 40);
    const filterM = /^\s*\.filter\s*\(/.exec(tail);
    if (filterM) {
      const filterOpenIdx = span.end + filterM[0].length - 1;
      const filterSpan = extractParenSpan(text, filterOpenIdx);
      if (filterSpan && optionValues(filterSpan.body).some((v) => ANY_MODE_RE.test(v))) return filterSpan.end;
    }
    return null;
  }

  let toolFiles = [];
  try {
    toolFiles = (await readdir(TOOLS_DIR)).filter((f) => f.endsWith(".mjs")).sort();
  } catch (e) {
    bad(`(e) could not list ${TOOLS_DIR}/ to scan for the onboarding idiom: ` + e.message);
    toolFiles = null;
  }

  if (toolFiles) {
    const offenders = []; // { file, line, reason }
    for (const fname of toolFiles) {
      if (fname === "dismiss-onboarding.mjs") continue;
      const path = TOOLS_DIR + "/" + fname;
      let rawText;
      try { rawText = await readFile(path, "utf-8"); } catch (e) { continue; }
      const text = stripComments(rawText);
      const fLineOf = (idx) => rawText.slice(0, idx).split("\n").length;

      // Collect every evaluate( ... ) call's line + extracted body.
      const evalCalls = [];
      const EVAL_RE = /\bevaluate\s*\(/g;
      let m;
      while ((m = EVAL_RE.exec(text))) {
        const openIdx = m.index + m[0].length - 1;
        const body = extractParenBlock(text, openIdx);
        if (body != null) evalCalls.push({ line: fLineOf(m.index), body });
      }

      // Collect every waitForTimeout( line number.
      const wftLines = [];
      const WFT_RE = /\bwaitForTimeout\s*\(/g;
      while ((m = WFT_RE.exec(text))) wftLines.push(fLineOf(m.index));

      const fileHits = [];

      // (i) waitForTimeout within 3 lines before a mode-card evaluate().
      // Requires an actual reference to the .ob-mode-card class alongside
      // the mode text - a bare mode word (e.g. "kiosk") also appears in
      // unrelated code, such as the .ob-kiosk-card class used by the
      // in-app #/kiosk route's own (unrelated) tour content.
      for (const ev of evalCalls) {
        if (!MODE_CARD_CLASS_RE.test(ev.body) || !ANY_MODE_RE.test(ev.body)) continue;
        const near = wftLines.some((w) => ev.line - w >= 1 && ev.line - w <= 3);
        if (near) fileHits.push({ line: ev.line, reason: "waitForTimeout(...) within 3 lines before an evaluate() matching a mode-card text" });
      }

      // (ii) any evaluate() body referencing the mode-card class, matching a
      // mode-card text, AND clicking.
      for (const ev of evalCalls) {
        if (MODE_CARD_CLASS_RE.test(ev.body) && ANY_MODE_RE.test(ev.body) && CLICK_RE.test(ev.body)) {
          fileHits.push({ line: ev.line, reason: "evaluate() body matches a mode-card text and calls .click(...)" });
        }
      }

      // (iii) local pastOnboarding/dismissOnboarding not importing the helper.
      FUNC_DECL_RE.lastIndex = 0;
      const localDecls = [];
      while ((m = FUNC_DECL_RE.exec(text))) localDecls.push({ line: fLineOf(m.index), name: m[1] });
      if (localDecls.length && !IMPORT_HELPER_RE.test(text)) {
        for (const d of localDecls) fileHits.push({ line: d.line, reason: `local ${d.name}() defined without importing tools/dismiss-onboarding.mjs` });
      }

      // Collect every mode-card LOCATOR (hasText, a chained .filter() with
      // the same regex, or a text= selector containing it) once, shared by
      // (iv) and (v) below.
      const modeLocatorHits = []; // { line, end }
      LOCATOR_RE.lastIndex = 0;
      while ((m = LOCATOR_RE.exec(text))) {
        const openIdx = m.index + m[0].length - 1;
        const matchEnd = matchModeLocatorEnd(text, openIdx);
        if (matchEnd == null) continue;
        modeLocatorHits.push({ line: fLineOf(m.index), end: matchEnd });
      }

      // (iv) a mode-card locator whose dismissal wait is a swallowed
      // `.waitFor(...).catch(...)` rather than a real, throw-loudly wait.
      for (const hit of modeLocatorHits) {
        // Within a short lookahead, find a .waitFor(...) whose result is
        // piped straight into .catch( - the swallow this shape is built on.
        const window = text.slice(hit.end, hit.end + LOCATOR_WAITFOR_WINDOW);
        WAITFOR_RE.lastIndex = 0;
        let wf, swallowed = false;
        while ((wf = WAITFOR_RE.exec(window))) {
          const wfOpenIdx = wf.index + wf[0].length - 1;
          const wfSpan = extractParenSpan(window, wfOpenIdx);
          if (!wfSpan) continue;
          if (CATCH_IMMEDIATELY_AFTER_RE.test(window.slice(wfSpan.end, wfSpan.end + 20))) { swallowed = true; break; }
        }
        if (swallowed) {
          fileHits.push({ line: hit.line, reason: "mode-card locator's dismissal wait is a swallowed .waitFor(...).catch(...) instead of a throw-loudly wait" });
        }
      }

      // (v) a waitForTimeout(...) shortly before a mode-card locator whose
      // only gate before use is `.count()`, with NO `.waitFor(` anywhere in
      // between the locator and that count check - a blind fixed delay
      // stands in for a real wait, and a falsy count is silently treated as
      // "nothing to do" instead of a miss worth surfacing.
      for (const hit of modeLocatorHits) {
        const near = wftLines.some((w) => hit.line - w >= 1 && hit.line - w <= 3);
        if (!near) continue;
        const window = text.slice(hit.end, hit.end + LOCATOR_WAITFOR_WINDOW);
        const countM = COUNT_RE.exec(window);
        if (!countM) continue;
        const beforeCount = window.slice(0, countM.index);
        if (!WAITFOR_TEST_RE.test(beforeCount)) {
          fileHits.push({ line: hit.line, reason: "waitForTimeout(...) before a mode-card locator gated only by .count(), with no .waitFor(...) at all - a missing/slow card is silently skipped instead of thrown" });
        }
      }

      for (const h of fileHits) offenders.push({ file: fname, line: h.line, reason: h.reason });
    }

    if (offenders.length) {
      const files = [...new Set(offenders.map((o) => o.file))];
      bad(`(e) ${offenders.length} old-onboarding-idiom hit(s) across ${files.length} file(s) in tools/*.mjs`);
      for (const o of offenders) console.log(`         ${o.file}:${o.line}: ${o.reason}`);
    } else {
      ok("(e) no old onboarding-dismissal idiom found in tools/*.mjs (all use the shared tools/dismiss-onboarding.mjs helper)");
    }
  }
}

/* ======================================================================
   (f) No RTCPeerConnection configuration anywhere in src/ may carry a
   non-empty iceServers list. Agnosticism audit, 6 Sep 2026 (network-
   agnostic, N2): the "no server, ever" promise and the network-priority-
   order rule (roadmap lock-in Q15 - local link first, internet/carrier
   connectivity never relied on) are enforced today only by being written
   down and by the fact that nothing currently calls RTCPeerConnection at
   all (a direct source search found zero hits, same as this check's own
   baseline). Nothing catches the day a well-intentioned "add a STUN
   server for reliability" patch quietly reintroduces an internet
   dependency - this is that catch, the transport-layer equivalent of
   test-room-privacy.mjs's wire-schema allowlist test. Scans every source
   file a future WebRTC transport could plausibly live in; a bare
   `new RTCPeerConnection()` (no config, or a config with no iceServers
   key, or an empty array) is fine - anything with a non-empty array is a
   FAIL, no exceptions, because the whole point is that this never needs a
   judgment call at the point someone adds one. */
{
  const RTC_SRC_FILES = [FILE, "src/room-web.js", "src/room-tauri.js", ...(await readdir("src/app-modules").catch(() => [])).filter((f) => f.endsWith(".js")).map((f) => "src/app-modules/" + f)];
  const RTC_CALL_RE = /new\s+RTCPeerConnection\s*\(([^)]*)\)/g;
  let rtcHits = 0, rtcOffenders = [];
  for (const f of RTC_SRC_FILES) {
    const text = f === FILE ? html : await readFile(f, "utf-8").catch(() => "");
    if (!text) continue;
    let m;
    while ((m = RTC_CALL_RE.exec(text))) {
      rtcHits++;
      const arg = m[1].trim();
      // A non-empty iceServers array: iceServers:[ followed by anything
      // other than immediate whitespace + ]. Deliberately loose (matches
      // even a commented-out or malformed attempt) - a false positive here
      // just means double-checking a line by eye, which is cheap; a false
      // negative would defeat the whole point of the check.
      const iceMatch = /iceServers\s*:\s*\[\s*([^\]])/.exec(arg);
      if (iceMatch) rtcOffenders.push({ file: f, line: text.slice(0, m.index).split("\n").length, snippet: m[0].slice(0, 140) });
    }
  }
  if (rtcOffenders.length) {
    bad(`(f) ${rtcOffenders.length} RTCPeerConnection call(s) with a non-empty iceServers list - this reintroduces an internet/carrier dependency the roadmap's network-priority-order rule (Q15) explicitly rules out`);
    for (const o of rtcOffenders) console.log(`         ${o.file}:${o.line}: ${o.snippet}`);
  } else {
    ok(`(f) no RTCPeerConnection config with a non-empty iceServers list (${rtcHits} RTCPeerConnection call(s) found, all local-only or none at all)`);
  }
}

/* ======================================================================
   (g) Every route in ROUTES has a matching entry in DEMO_NOTES. The Guided
   Tour's own DEMO_STEPS (renderKioskMode(), profile.js) already solved
   "a route can silently be forgotten from the walk" by deriving the WALK
   itself from ROUTES instead of hand-maintaining a second list - but the
   per-stop COPY still comes from DEMO_NOTES, a separately hand-keyed
   dictionary nothing cross-checks against ROUTES. A route with no matching
   key doesn't break anything - DEMO_STEPS' own `n.d || (r.label + " — see
   this section in the app.")` fallback covers it - but it means a brand
   new section can ship with a tour stop that has nothing to say about it,
   the same "forgotten route" failure one layer down. Root-caused during
   the Highlights-track pitch (2026-09) when #/group, a route on a separate
   branch, was found in exactly this state.

   #/kiosk and #/profile are deliberately excluded here, matching DEMO_STEPS'
   own filter (`r.hash !== "#/kiosk" && r.hash !== "#/profile"`) - neither
   ever becomes a tour stop, so neither needs an entry.
   ====================================================================== */
{
  function extractBalanced(text, openIdx, openChar, closeChar) {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
      if (text[i] === openChar) depth++;
      else if (text[i] === closeChar) { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
    }
    return null;
  }
  const routesDeclIdx = html.indexOf("const ROUTES = [");
  const notesDeclIdx = html.indexOf("const DEMO_NOTES = {");
  if (routesDeclIdx === -1 || notesDeclIdx === -1) {
    bad("(g) could not locate ROUTES and/or DEMO_NOTES declarations");
  } else {
    const routesBody = extractBalanced(html, html.indexOf("[", routesDeclIdx), "[", "]");
    const notesBody = extractBalanced(html, html.indexOf("{", notesDeclIdx), "{", "}");
    if (routesBody == null || notesBody == null) {
      bad("(g) could not extract the balanced ROUTES/DEMO_NOTES body");
    } else {
      const EXCLUDED = new Set(["#/kiosk", "#/profile"]);
      const routeHashes = [...routesBody.matchAll(/hash:\s*"(#\/[a-z0-9-]+)"/g)].map((m) => m[1]).filter((h) => !EXCLUDED.has(h));
      // DEMO_NOTES keys are the object's own top-level `"#/xxx":` entries -
      // matched directly against notesBody (already balanced/scoped to just
      // this object), not the whole file, so a route hash appearing
      // elsewhere in the file's prose/comments can't produce a false match.
      const noteKeys = new Set([...notesBody.matchAll(/"(#\/[a-z0-9-]+)":/g)].map((m) => m[1]));
      const missing = routeHashes.filter((h) => !noteKeys.has(h));
      if (missing.length) {
        bad(`(g) ${missing.length} route(s) with no matching DEMO_NOTES entry - the Guided Tour's Highlights/full tracks will fall back to generic copy for: ${missing.join(", ")}`);
      } else {
        ok(`(g) every route has a matching DEMO_NOTES entry (${routeHashes.length} routes, ${EXCLUDED.size} intentionally excluded)`);
      }
    }
  }
}

/* ======================================================================
   (h) G.whatsNew.RELEASE_NOTES (src/index.html) must have an entry whose
   `version` matches package.json's own "version" - the only way a release
   can ship without its in-app "What's new" panel silently going stale
   (still showing the PREVIOUS release's notes, or none at all, to a
   Soldier who just updated). This is a standing product requirement, not
   a style preference: see G.whatsNew's own header comment in index.html.
   A version bump with no matching entry, or an entry whose `highlights`
   array is empty, both fail loudly here instead of shipping quietly wrong.
   ====================================================================== */
{
  function extractBalanced(text, openIdx, openChar, closeChar) {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
      if (text[i] === openChar) depth++;
      else if (text[i] === closeChar) { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
    }
    return null;
  }
  const declIdx = html.indexOf("G.whatsNew = {");
  if (declIdx === -1) {
    bad("(h) could not locate the G.whatsNew declaration");
  } else {
    const notesDeclIdx = html.indexOf("RELEASE_NOTES: [", declIdx);
    const body = notesDeclIdx === -1 ? null : extractBalanced(html, html.indexOf("[", notesDeclIdx), "[", "]");
    if (body == null) {
      bad("(h) could not extract G.whatsNew.RELEASE_NOTES's balanced array body");
    } else {
      const versions = [...body.matchAll(/version:\s*"([^"]+)"/g)].map((m) => m[1]);
      const pkgVersion = PKG.version;
      if (!versions.length) {
        bad(`(h) G.whatsNew.RELEASE_NOTES is empty - package.json is at ${pkgVersion} with no matching "what's new" entry`);
      } else if (versions[versions.length - 1] !== pkgVersion) {
        bad(`(h) G.whatsNew.RELEASE_NOTES's last entry is ${versions[versions.length - 1]}, but package.json is ${pkgVersion} - add a release-notes entry for ${pkgVersion} (see G.whatsNew's own header comment for the plain-language style this needs)`);
      } else {
        // Confirm the CURRENT version's own entry actually has highlights -
        // catches a bump that added the version key but left the array
        // empty (e.g. a stub committed to satisfy this check literally).
        const currentBlockIdx = body.lastIndexOf('version: "' + pkgVersion + '"');
        const highlightsIdx = body.indexOf("highlights:", currentBlockIdx);
        const highlightsBody = highlightsIdx === -1 ? null : extractBalanced(body, body.indexOf("[", highlightsIdx), "[", "]");
        const highlightCount = highlightsBody == null ? 0 : (highlightsBody.match(/"(?:[^"\\]|\\.)*"/g) || []).length;
        if (!highlightCount) {
          bad(`(h) G.whatsNew.RELEASE_NOTES's entry for ${pkgVersion} has no highlights - a Soldier updating to this release would see an empty "What's new" panel`);
        } else {
          ok(`(h) G.whatsNew.RELEASE_NOTES has a real entry for the current version (${pkgVersion}, ${versions.length} total entries, ${highlightCount} highlight(s) for this one)`);
        }
      }
    }
  }
}

console.log("\n" + (fails ? `LINT-PATTERNS: ${fails} FAILURE(S)` : "LINT-PATTERNS: all passed"));
process.exit(fails ? 1 : 0);
