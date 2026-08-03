# GUIDON — Design System Reference

**For:** a designer or design tool picking this app up cold.
**Build:** `guidon_73.html` · single file, ~5 MB, fully offline, no build step, no framework.
**Date:** 2026-07-23

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
`--text-dim` — supporting copy (**passes 4.5:1 in all 14 themes**)
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

---

## 3. Themes — 14

**Dark (9):** blackout · nautical-dusk · night-vision · range-red · signal-amber · slate-focus · squadron-blue · subdued · topographic
**Light (5):** desert-cadence · field-manual · ink-paper · parade-rest · sepia-study

Light themes require **both** `data-theme="<name>"` on `<html>` **and** the `light` class. Setting one without the other produces a broken hybrid — this has caused phantom test failures more than once.

Theme choice persists to `localStorage` under `guidon:appearance:v1`.

> **Honest assessment:** 14 themes is a maintenance liability. Every new component must clear 4.5:1 in all 14, which is why contrast regressions keep appearing. A designer should feel free to ask whether all 14 earn their place.

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

**Motion:** only **3 `@keyframes`** in 174 KB of CSS. The app is essentially static. For an instrument-panel aesthetic this is a real opportunity — but `prefers-reduced-motion` handling already exists and must be respected.

---

## 6. Architecture constraints a designer must know

1. **Single file, no build step.** No preprocessor, no PostCSS, no autoprefixer. Everything is hand-authored CSS in 3 `<style>` blocks. `color-mix()` is used and relied upon.
2. **Fully offline.** No web fonts, no CDN, no network calls of any kind. Fonts are system stacks. Any design that needs a downloaded asset is out of scope.
3. **Modules are IIFEs sharing a global `G`.** Anything one module needs from another must be explicitly exposed (`G.routes`, `G.renderBoardCountdown`, `G.profile.cached()`). A `typeof X !== "undefined"` guard across module boundaries fails *silently to empty* — this caused a real bug.
4. **24 routes** derived from a single `ROUTES` array. The Demo Center tour derives from it. Adding a section = adding to `ROUTES`; do not hand-maintain parallel lists.
5. **IndexedDB** holds profile, card grades, settings. Schema changes must be backwards compatible — existing profiles cannot break.

---

## 7. Verification standard

Any visual change should clear this before shipping:

- `node --check` on all inline scripts; CSS brace balance on all 3 blocks
- **axe-core across 14 themes × 12 sections — target 0 WCAG 2 A/AA violations**
- Console clean at **both `error` and `warning`** levels
- No horizontal overflow at 360 px and 1280 px

**Two timing rules, learned the hard way:**
- Settle **longer than the longest CSS transition** (currently `0.15s` on nav) before sampling colour. A 150 ms settle produced phantom violations.
- Settle **after each theme change**, not only after navigation — a theme switch triggers colour transitions across the entire UI.

Ignoring either produces violations that do not exist and invites "fixing" working code.

---

## 8. Known design debt

| Item | Detail |
|---|---|
| 14 themes | Every component must clear contrast in all of them |
| 21 media conditions | Should consolidate to a named scale |
| Near-zero motion | 3 keyframes total; opportunity, not a defect |
| Native `prompt()`/`confirm()` | Account panel uses them; unthemed and poor on mobile |
| `guidon-theme-proposals.html` | Documents 5 themes; app has 14. **Three-quarters stale** |
| Screen-reader testing | Never done. Automated tooling catches roughly a third of real issues |

---

## 9. Where to start

1. Read this file and open `guidon_73.html` in a browser — cycle all 14 themes on `#/home` and `#/board`.
2. **Do not** introduce a hardcoded colour. If an accent must be text, use `--ink-*`. If text sits on an accent fill, use `--btn-ink`.
3. Consolidate breakpoints before touching components — it makes everything after it cheaper.
4. Run the verification standard in §7 after every visual change, with both timing rules applied.
