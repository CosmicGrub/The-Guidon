# GUIDON — Design System Reference

**For:** a designer or design tool picking this app up cold.
**Build:** `src/index.html` — single-file source, ~5 MB. `node tools/build.mjs` produces `dist/guidon-standalone.html` (file://-ready, one file) and `web/index.html` (installable PWA bundle). No preprocessor, no framework — hand-authored CSS in 3 `<style>` blocks. (`guidon_NN.html`-numbered snapshots, e.g. `guidon_73.html`, are a retired pre-build-pipeline naming convention still sitting in `GUIDON files/` — `src/index.html` is the only source of truth now.)
**Date:** 2026-08-09 (v1.4.13)

---

## 1. What this app is, visually

An **instrument-panel aesthetic** — the visual language of field equipment and printed Army forms rather than consumer software. Monospace accents, hairline rules, panel-on-panel layering, restrained colour used as signal rather than decoration. It is used one-handed on a tablet in a motor pool as often as at a desk.

**Primary showcase device:** Samsung Galaxy Tab S9 FE 5G — 2304×1440 physical, DPR 2, so **CSS viewport is ~1152×720 landscape / ~720×1152 portrait**. S Pen hover is detected via Pointer Events, not CSS media queries (a touch-primary device reports no hover capability even when a stylus is present).

---

## 2. Design tokens — 33 custom properties

Every theme redefines this set. **Nothing outside a theme block should hardcode a colour.**

### Surfaces
`--bg` · `--bg-2` · `--bg-3` — page and nested backgrounds, darkest to lightest
`--panel` · `--panel-2` — card and panel fills
`--line` · `--line-2` — hairline dividers
`--border` — component borders
`--shadow` — elevation

### Text
`--text` — primary
`--text-1` · `--text-2` — secondary tiers
`--text-dim` — supporting copy (**passes 4.5:1 in all 24 themes**)
`--text-mute` — decorative only (**does NOT pass 4.5:1 in most themes — never use for body text**)

### Accent
`--amber` · `--amber-dim` · `--green` · `--cyan` · `--red` · `--violet` · `--brass` · `--glow-amber`

These are tuned to work as **backgrounds and borders**, not as text.

### Text-safe accent variants — use these when an accent must be text
`--ink-amber` · `--ink-green` · `--ink-cyan` · `--ink-red` · `--ink-violet`

Each is `color-mix(in srgb, <accent> 60%, var(--text) 40%)`. This preserves the colour's identity while inheriting `--text`'s guaranteed contrast. **This exists because raw accents used as text failed 4.5:1 on the warm themes and caused 37 of 50 contrast violations in one audit.**

### Ink on accent fills
`--btn-ink` — computed per theme for text sitting *on* an accent background.

**This is the single most-violated rule in the codebase.** Hardcoding `#000` or `#fff` on an accent fill has produced contrast failures three separate times (`.ob-avatar` at 2.55:1, `.ob-g-mark`, the segmented-button active states). If text sits on `--amber`, `--green`, `--red` etc., it uses `--btn-ink`.

### Shape and type
`--radius` · `--radius-sm` · `--font-head` · `--font-body` · `--font-mono`

### Motion — duration/easing tokens
`--dur-base` · `--ease-standard` — the general-purpose pair, added when the nav accordion and fill bars were converted to real transitions. Component-specific pairs exist alongside it rather than folding into it, because each was tuned by ear for what it drives: `--qz-flip-dur`/`--qz-flip-ease` (the board-drill 3D flip), `--quiz-dur`/`--quiz-ease` (quiz card entrance/exit), `--modal-dur`/`--modal-ease` (dialogs and the PDF-filler modal). All of them are redefined per `html[data-motion="standard|rich|cinematic"]` — `data-motion="minimal"` and `prefers-reduced-motion` bypass the tokens entirely via a global kill-switch (`animation-duration`/`transition-duration: .001ms !important`), so a new transition that reads these tokens is reduced-motion-safe with no extra CSS. The one exception: a *persistent-state* transform (like the flip card's `rotateY`) needs a bespoke `minimal`/`reduce-motion` fallback rule, since collapsing the duration alone would leave it stuck mid-transition rather than snapping to its resting state.

---

## 3. Themes — 24

**Dark (15):** blackout · clay-warm · graphite-calm · harbor-mid · nautical-dusk · night-vision · pine-dusk · range-red · signal-amber · slate-focus · slate-quiet · squadron-blue · subdued · topographic · umber-lamp
**Light (9):** bone-neutral · desert-cadence · field-manual · ink-paper · overcast-glare · parade-rest · parchment-read · sandstone-sun · sepia-study

Themes also carry a `kind` ("dark"/"light") and a `group` ("Standard", "Focus", "High-contrast") in the theme-picker's own data, used for menu organization only — nothing in the CSS keys off `group`.

Light themes require **both** `data-theme="<name>"` on `<html>` **and** the `light` class. Setting one without the other produces a broken hybrid — this has caused phantom test failures more than once.

Theme choice persists to `localStorage` under `guidon:appearance:v1`.

> **Honest assessment:** 24 themes is a maintenance liability, more so than when this note first said 14. Every new component must clear 4.5:1 in all 24, which is why contrast regressions keep appearing. A designer should feel free to ask whether all 24 earn their place — but note the count grew *after* this doc first flagged it as a liability, not before, so the pressure hasn't worked as a deterrent so far.

---

## 4. Layout and breakpoints

**21 distinct media conditions**, which is more than a system needs. The de-facto breakpoints:

| Condition | Purpose |
|---|---|
| `max-width: 400/420/480px` | small phone |
| `max-width: 540/560/640px` | phone |
| `max-width: 859px` / `min-width: 860px` | **primary layout switch** — sidebar nav ↔ bottom tab bar |
| `min-width: 768/1024/1200px` | tablet and desktop refinements |
| `hover: none` | touch-primary adjustments |

**Consolidating these to a named 4–5 step scale is a legitimate early win for a design pass.** They accreted rather than being designed.

Verified layout floor: **no horizontal overflow at 360 px** across every section.

---

## 5. Component inventory

~915 distinct CSS classes. The load-bearing ones:

**Structure** — `.panel` `.card` `.section-title` `.rule` `.eyebrow` `.hint` `.view-intro` `.stat` `.bar` `.feedback` (+`.warn`)
**Navigation** — `.nav` `.nav-group-header` `.segmented` `.tabBtn` `.chip`
**Buttons** — `.btn` with `.primary` `.ghost` `.sm` `.tiny`
**Onboarding / profile** — `.ob-*` (overlay, step, card, avatar, plan, rank, weak, check)
**Board drill** — `.qz-*` (3D flip card, S Pen hover)
**Forms** — `.frm` `.da` (DA-form replicas; print-oriented)

**Motion:** **7 `@keyframes`** (`fade`, `cardIn`, `guidon-shimmer`, plus four quiz-card ones — `quizCardIn`/`quizCardOut`/`quizCorrectPulse`/`quizWrongShake`), up from 3 as of a dedicated motion pass across board-drill, quiz, modals, fill bars, and the nav accordion (see §2's Motion tokens). Most of the app's motion is transition-driven rather than keyframed, which is why this count alone understates the coverage — check for a component's relevant `--dur-*`/`--ease-*` token before assuming it's untouched. `prefers-reduced-motion` handling predates all of it and every addition since has been built to respect the same kill-switch.

---

## 6. Architecture constraints a designer must know

1. **Single file, no build step.** No preprocessor, no PostCSS, no autoprefixer. Everything is hand-authored CSS in 3 `<style>` blocks. `color-mix()` is used and relied upon.
2. **Fully offline.** No web fonts, no CDN, no network calls of any kind. Fonts are system stacks. Any design that needs a downloaded asset is out of scope.
3. **Modules are IIFEs sharing a global `G`.** Anything one module needs from another must be explicitly exposed (`G.routes`, `G.renderBoardCountdown`, `G.profile.cached()`). A `typeof X !== "undefined"` guard across module boundaries fails *silently to empty* — this caused a real bug.
4. **35 routes** derived from a single `ROUTES` array. The Demo Center tour derives from it. Adding a section = adding to `ROUTES`; do not hand-maintain parallel lists.
5. **IndexedDB** holds profile, card grades, settings. Schema changes must be backwards compatible — existing profiles cannot break.

---

## 7. Verification standard

Any visual change should clear this before shipping:

- `node --check` on all inline scripts; CSS brace balance on all 3 blocks
- **axe-core across 24 themes × 35 routes (840 combinations) — target 0 WCAG 2 A/AA violations.** This runs as `tools/test-contrast-full.mjs`, wired into the default `npm test` battery (`npm run test:contrast-full`) — not a script that has to be remembered and run separately.
- Console clean at **both `error` and `warning`** levels
- No horizontal overflow at 360 px and 1280 px

**Two timing rules, learned the hard way — plus how the tests actually handle it now:**
- Settle **longer than the longest CSS transition** before sampling colour, or better: kill transitions/animations outright. `tools/test-contrast.mjs` and `tools/test-contrast-full.mjs` both do the latter — `*, *::before, *::after { transition: none !important; animation: none !important; }` injected before any sampling — which is why they can get away with a 350ms per-route / 40ms per-theme settle even though the motion pass in §2/§5 pushed the app's longest real transition well past what a settle-only approach could keep up with (`--qz-flip-dur` alone reaches `.95s` at cinematic). A 150ms settle with transitions still live produced phantom violations, which is what motivated disabling them instead of chasing an ever-growing "longest transition" number.
- Settle **after each theme change**, not only after navigation — a theme switch triggers colour transitions across the entire UI (or would, if the sweep above hadn't already killed them).

Ignoring either produces violations that do not exist and invites "fixing" working code.

---

## 8. Known design debt

| Item | Detail |
|---|---|
| 24 themes | Every component must clear contrast in all of them |
| Screen-reader testing | Never done with a real AT/user. Automated tooling catches roughly a third of real issues |

**Closed since this table last needed updating** — kept here so a reader doesn't have to rediscover them: near-zero motion (§5, 3 → 7 keyframes plus a real transition-token system); native `prompt()`/`confirm()` (`modal.js`'s `G.modal.confirm`/`G.modal.prompt` replaced every call site app-wide, and picked up real enter/exit motion of its own); `guidon-theme-proposals.html` (the file no longer exists in the repo — nothing left to reconcile); 21 ad-hoc media conditions (consolidated to an 8-value canonical scale — see the doc comment above the first width-based `@media` rule in `src/index.html`, near line 396 — with `tools/lint-patterns.mjs` check (d) enforcing it going forward).

---

## 9. Where to start

1. Read this file, then run `node tools/build.mjs` and open `dist/guidon-standalone.html` in a browser — cycle all 24 themes on `#/home` and `#/board`.
2. **Do not** introduce a hardcoded colour. If an accent must be text, use `--ink-*`. If text sits on an accent fill, use `--btn-ink`.
3. Consolidate breakpoints before touching components — it makes everything after it cheaper.
4. Run the verification standard in §7 after every visual change, with both timing rules applied.
