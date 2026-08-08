# GUIDON — Masterfile

**Status:** Reconstructed from source (`guidon_31.html`, user-supplied) on 2026-07-13 after the prior handoff chat (and its GUIDON_MASTERFILE.md / CHANGELOG.md / GUIDON_STATE.json) was lost. This document reflects what is *actually present in the code*, not inferred intent — where something couldn't be confirmed from source it is marked `[UNCONFIRMED]`.

---

## 1. What GUIDON Is

A single-file, fully offline Army leader-development trainer for E1–E6, covering doctrine study, promotion-board prep, and a scenario/counseling engine. Runs from a single `.html` file with zero setup — no build step, no server, no network dependency.

- **Title:** GUIDON — Army Leader Development Trainer
- **Meta description (verbatim from source):** "Offline single-file Army leader-development trainer (E1-E6): doctrine, board prep, and a unified scenario engine with text, course, and choose-your-own-adventure modes. Runs with zero setup, fully offline."
- **File size at last known snapshot (`guidon_31.html`):** ~4.8 MB, 14,566 lines.
- **No Android/APK packaging markers found** in this build (earlier lineage, e.g. the 62nd EN BN "Board Prep" predecessor, had a Cordova/APK pipeline — that packaging does not appear present in `guidon_31.html`). Treat as **web-app-only** until confirmed otherwise.

---

## 2. Technical Architecture

### File structure
One HTML file, three notable regions:
1. **Pre-paint bootstrap script** (in `<head>`, before CSS) — reads `localStorage["guidon:appearance:v1"]` synchronously and sets `data-theme`, `data-motion`, `data-type`, `data-text-scale`, `data-line-spacing`, `data-nav-density`, `data-nav-labels` attributes on `<html>` before first paint, to avoid a flash of default theme.
2. **`<style>` block** — full design system: instrument-panel dark theme by default, CSS custom properties per theme.
3. **Application `<script>` block(s)** — the bulk of the file (~11,000+ lines): data (card corpus, acronym dictionary, points/resilience/transition content) plus the app logic (rendering, persistence, PDF export).

A large **vendored `pdf-lib` build** (Apache-2.0, Microsoft-authored base64 utilities + PDF manipulation) is embedded inline, used to fill/export a real **DA Form 4856** (Developmental Counseling Form) with base64 font tables (Courier/Helvetica/Times family + Symbol/ZapfDingbats AFM metrics) bundled for text-layout purposes.

### Persistence
- **`localStorage["guidon:appearance:v1"]`** — JSON blob for appearance/display prefs (theme, motion, type pairing, text scale, line spacing, nav density/labels, auto-night settings, high-contrast, large-targets, reduce-motion).
- **IndexedDB database `"guidon"`, version `1`** (`DB_NAME`/`DB_VERSION` constants) — used for larger/structured state (study progress, SRS-style tracking, etc. — exact object stores not fully enumerated in this pass; re-verify against `SCHEMA` constant in source if this matters for a feature change).
- Additional top-level constants of interest for anyone extending the app: `STORE_KEY`, `SAVE_KEY`, `GOAL_KEY`, `CHK`, `SIG` — these look like additional localStorage/state keys beyond the appearance blob. **[UNCONFIRMED scope — grep source before assuming a key is unused.]**

### Appearance system (fully confirmed from source)
- **14 themes** (`T` array in bootstrap): `field-manual` (default), `night-vision`, `topographic`, `parade-rest`, `blackout`, `desert-cadence`, `squadron-blue`, `range-red`, `subdued`, `slate-focus`, `nautical-dusk`, `sepia-study`, `signal-amber`, `ink-paper`.
  - Of these, **5 light themes**: `field-manual`, `parade-rest`, `desert-cadence`, `sepia-study`, `ink-paper` (rest are dark).
  - This is a significant expansion from the original 5-theme proposal set seen in `guidon-theme-proposals.html` (Night Vision / Field Manual / Topographic / Parade Rest / Blackout) — 9 more themes were added since.
- **4 motion levels** (`M` array): `minimal`, `standard`, `rich` (current default), `cinematic`.
- **7 type/typography pairings** (`Y` array): `command` (default), `field`, `humanist`, `classic`, `readable`, `terminal`, `broadsheet`.
- **Auto-night mode**: optional, switches to a configurable night theme (default `night-vision`) between configurable start/end hours (default 20:00–06:00).
- **Accessibility toggles**: `highContrast`, `largeTargets`, `reduceMotion` (also auto-applied when motion=`minimal`).
- **Text scale**: `compact` / `standard` / `large` / `xlarge`.
- **Line spacing**: `tight` / `normal` / `relaxed`.
- **Nav density**: `comfortable` (default) / `compact`. **Nav labels**: on by default, can be hidden.

### Content-safety / integrity notes from source comments
- A `# END OF FILE` / provenance-style comment culture is present in some embedded assets (inherited from the pdf-lib vendor code, not GUIDON's own convention).

---

## 3. Content Inventory (confirmed via corpus scan)

### Doctrine Q&A corpus
- **~1,992 item IDs** detected matching the card-object `"id"` field pattern (this count includes all card-like objects across the file; treat as an upper-bound estimate of corpus size pending a clean re-count against the actual `DECKS`/card-array variable name, which was not isolated in this pass).
- **109 distinct category values**, spanning (non-exhaustive, alphabetized sample): ACFT, ADP 1/3-0/3-28/5-0/6-0/6-22/7-0, AR 350-1/600-9/600-20/600-52/623-3/670-1, ATP 6-22.1, Army Body Composition Program, Army History, Army Medical System, Army Programs, Army Values, Attributes, Awards, Board Procedures, CBRN Defense, Chain of Command, Combatives, Counseling, Counterproductive Leadership, Creeds, Customs & Courtesies, DA PAM 750-8, Development, Discipline, Drill and Ceremony, Equal Opportunity, Evaluations, FM 3-0/3-11/3-90/7-22, Financial (Readiness), Fitness / ABCP, GI Bill and Education Benefits, General Orders, Inspector General, Land Navigation, Law of Armed Conflict, Leadership (Requirements Model), Leave & Passes, Legal / SHARP / Safety, ...and more (full 109-item list not reproduced here; regenerate with `grep -o '"category": "[^"]*"' guidon_31.html | sort -u` against the current build).
- Each card object carries: `id`, `category`, `q`, `a`, `source`, `acceptableAnswer`, `boardAnswer`, `concept`, `keyPoints[]`. This is a richer schema than a plain flashcard — it's built for **board-answer coaching**, not just recall (separate "acceptable" vs. "board" phrasing, a `concept` summary line, and bulleted `keyPoints`).

### Acronyms & Terms dictionary
- **3,592 total terms**, tagged `src: "army"` (Army-specific) or `src: "both"` (joint/DoD).
- Sourced from the DoD Dictionary of Military and Associated Terms (Abbreviations/Acronyms/Initialisms), audited down to Army-relevant scope (single-service Navy/Air Force/Marine/Coast Guard/Space Force-only terms removed; joint terms retained/retagged).
- `"asOf": "2021 (DoD) + Army overlay"` — **this dictionary's DoD baseline is stale (2021)**; flag for a refresh pass if accuracy-sensitive terms (ranks, current-year program names) matter.

### Promotion Points module
- `"version": "0.1.0"`, `"generatedAsOf": "2026-07"`.
- Models the **semi-centralized (SGT/SSG) 800-point system**: categories are Military Training (max 340), Awards/Decorations/Achievements (max 160), Military Education (max 200), Civilian Education (max 100), Board Score/DA Form 3356 (max 150) — sub-maxes can exceed 800 in aggregate but total is hard-capped at 800.
- Includes a `coaching` array — threshold-triggered tips per category (e.g., below 60% training → fitness/weapons-qual advice; below 60% board score → drill recommendations).
- Explicitly labeled **"PRACTICE ESTIMATE ONLY"** with a disclaimer to verify against DA Form 3355/S1 — good pattern, keep it if extending this module.

### Resilience / H2F module
- `"title": "Holistic Health & Resilience"`, based on Army H2F framework (FM 7-22, 2020) + MRT (Master Resilience Trainer) curriculum (UPenn Positive Psychology Center lineage).
- `"asOf": "Jul 2026"`.
- **6 domains**: Physical, Nutritional, Mental, Spiritual, Sleep, Social — each with a `desc` and 3–4 `skills` (each skill has a `body` and practical guidance).
- A flattened `skills[]` array duplicates/cross-references domain skills with `points[]` bullet lists and a `ref` citation (e.g., "Army MRT curriculum", "AR 600-63 / Army ACE Training").
- Includes crisis resources (`resources[]`): Veterans Crisis Line, Army Chaplain, Army Community Service, Behavioral Health, MRT Resources, H2F Performance Teams, PACT Act resources, DAV, Real Warriors Campaign, SpouseWorks/MYCAA.
- Correctly labeled as **"Educational content — not clinical mental health treatment"** with crisis-line info surfaced. Preserve this framing in any edits.

### Transition & ETS Readiness module
- `"title": "Transition & ETS Readiness"`, `"asOf": "Jul 2026"`.
- A **milestone timeline** from 730 days before ETS through 90 days *after* ETS, each milestone with a `color` (green/amber/red urgency) and an `items[]` checklist. Covers SFL-TAP enrollment, BDD (Benefits Delivery at Discharge) filing window (180–90 days pre-ETS, hard deadline), DD-214 block-by-block explanation (all ~19 key blocks annotated), VA claim tracker (7-step), IDES/LDES explainer, career-path guidance (federal hiring incl. veterans' preference codes CPS/CP/XP/TP/SSP, GI Bill, SkillBridge, VR&E/Ch.31, SDVOSB, defense-contractor sector, LinkedIn Premium, Hiring Our Heroes), and a large curated **resources directory** (30+ categories: apprenticeships, AI tools, career counseling, certs, consumer protection, cost-of-living calculators, education, employment-rights law, entrepreneurship, homelessness support, interview prep, job boards, legal, mental health, mentorship, terminology translation, spouse employment, networking, resume tools, social media, supportive services, taxes, volunteering, caregiver support).
- Explicitly labeled **"Educational study aid — not official VA, DoD, or legal guidance."**
- This is a *substantial* addition beyond pure board-prep/doctrine content — GUIDON has grown from "board prep app" into a broader soldier-lifecycle tool (board prep + H2F/resilience + ETS/transition).

### Chain of Command / unit-specific data
- Prior lineage (62nd EN BN export) had a live-editable Chain of Command deck. **Not yet re-confirmed** whether `guidon_31.html` retains this editable-CoC pattern — check for a `chainOfCommand` object/editor UI before assuming it's gone or present.

---

## 4. Known Version Markers Found In-Content

These are **content `"asOf"` stamps inside data objects**, not necessarily a single coherent app version number. No single `APP_VERSION` constant was isolated in this pass:

| Marker | Context |
|---|---|
| v0.36.0, v0.42.0, v0.42.1, v0.43.0, v0.43.1, v0.44.0 | Appear inside card `"asOf"` strings, e.g. one DA 4856 example card cites "v0.43.1 — 59 DA 4856 examples imported from unit MOI library" |
| Points module | `"version": "0.1.0"` |
| Acronyms dictionary | `"asOf": "2021 (DoD) + Army overlay"` |
| Resilience module | `"asOf": "Jul 2026"` |
| Transition module | `"asOf": "Jul 2026"` |

**Action item:** if a single app-level semantic version is wanted going forward, introduce one explicit `APP_VERSION` constant and stop relying on scattered content-level `asOf` stamps as a proxy for build version.

---

## 5. Drive Build Lineage (for continuity)

Prior builds saved to Google Drive (oldest → newest, all named `guidon_N.html`):

| File | Modified | Size |
|---|---|---|
| guidon_1.html | 2026-07-07 | 636 KB |
| guidon_3.html | 2026-07-07 | 793 KB |
| guidon_5.html | 2026-07-07 | 906 KB |
| guidon_7.html | 2026-07-08 | 953 KB |
| guidon_8.html | 2026-07-11 | 2.0 MB |
| guidon_31.html (user-supplied) | 2026-07-13 | 4.8 MB |
| guidon_32.html (adds MOS Career Center) | 2026-07-13 | 4.92 MB |
| guidon_33.html (collapsible nav groups) | 2026-07-13 | 4.92 MB |
| guidon_34.html (cross-device/foldable responsiveness) | 2026-07-13 | 4.92 MB |
| guidon_35.html (device/input-mode auto-detection) | 2026-07-13 | 4.92 MB |
| guidon_36.html (Demo Center: Guided Tour + Free Mode) | 2026-07-13 | 4.93 MB |
| guidon_37.html (real rendering bugs fixed via Playwright) | 2026-07-13 | 4.94 MB |
| guidon_38.html (Board Drill rebuilt as Quizlet-style flip cards) | 2026-07-13 | 4.94 MB |
| guidon_39.html (one a11y fix from audit) | 2026-07-13 | 4.94 MB |
| guidon_40.html (audit proposal implemented) | 2026-07-13 | 4.94 MB |
| guidon_41.html (S Pen hover support + 90Hz audit) | 2026-07-14 | 4.95 MB |
| guidon_42.html (pre-demo hardening pass) | 2026-07-14 | 4.95 MB |
| guidon_43.html (quick full-app audit, contrast down 53% more) | 2026-07-15 | 4.95 MB |
| **guidon_46.html** (this session's build — found and fixed the real reason Progress never showed board data) | 2026-07-20 | 4.95 MB |

The jump from guidon_8 (2.0MB) to guidon_31 (4.8MB) reflected the acronyms dictionary, transition/ETS module, resilience/H2F module, points calculator, pdf-lib DA 4856 export, and 9 additional themes. guidon_31→guidon_32 added the **MOS Career Center** (§7). guidon_32→guidon_33 was a nav-presentation change (§8). guidon_33→guidon_34 was a responsiveness/CSS-only change (§9). guidon_34→guidon_35 added device/input-mode auto-detection (§10). guidon_35→guidon_36 rebuilt Kiosk Mode into a Demo Center (§11). guidon_36→guidon_37 fixed 3 real rendering bugs found via Playwright (§12). guidon_37→guidon_38 rebuilt Board Drill into Quizlet-style flip cards (§13). guidon_38→guidon_39 fixed one a11y bug from a comprehensive audit (§14). guidon_39→guidon_40 implemented that audit's proposal (§15). guidon_40→guidon_41 optimized for the Tab S9 FE's actual hardware (§16–17). guidon_41→guidon_42 was a pre-demo hardening pass (§18). guidon_42→guidon_43 was a quick full-app audit + hardening pass (§19). guidon_43→guidon_44 deduplicated the board card corpus and rebuilt the grading system (§20). guidon_44→guidon_45 connected that grading system to Progress and fixed what looked like a gating bug (§21). guidon_45→guidon_46 found and fixed the actual root cause (§22). guidon_46→**guidon_47** reconciled a parallel branch fork and cleared the last contrast violations (§23). **guidon_86.html is the current source of truth** (guidon_84 + hosted access & Share panel).

---

## 6. Known Open Items / Things To Verify Next Session

1. **Confirm the exact card/deck array name and get a clean corpus count** — this reconstruction estimated ~1,992 cards from ID-pattern matching, which may over/undercount if other objects share the `"id":` key pattern.
2. **Confirm whether Chain-of-Command live-editing survived** from the 62nd EN BN lineage into GUIDON, or whether it was cut/replaced.
3. **Re-verify IndexedDB schema** (`SCHEMA` constant, `DB_NAME="guidon"`, `DB_VERSION=1`) — what object stores exist, and whether a schema migration path exists if `DB_VERSION` needs to bump.
4. **No Android/APK packaging found in this build** — confirm with the user whether GUIDON is now web-only by design, or whether a native wrapper still exists elsewhere and just wasn't in this HTML file (it wouldn't be, structurally — but worth confirming intent).
5. **Acronyms dictionary is DoD-2021-vintage** — flag for the user in case a refresh is wanted.
6. **Establish a single `APP_VERSION` constant** going forward instead of relying on scattered `asOf` content stamps, per §4 above.
7. **Theme proposals reconciliation** — `guidon-theme-proposals.html` (in this project's knowledge) proposed 5 themes; the live app has 14. Confirm whether the theme-proposals doc should be updated/retired, since it no longer reflects current scope.

---

---

## 8. Sidebar Nav Consolidation (new this session)

**Problem addressed:** the live app's sidebar had 18 flat top-level items — user flagged this from a screenshot as visually noisy and asked for the layout to be cleaned up / categories minimized.

**Fix:** Home stays a standalone top item; the other 17 routes are grouped into **5 collapsible, labeled clusters**:
- **Board Prep** — Train, Board, Doctrine, Terms
- **Study & Skills** — Learn, Forms, Write
- **Leadership** — Counsel, Develop, Risk
- **Career & Life** — MOS, Money, Health, ETS, Resources
- **Account** — Progress, Author, Settings

Only the group containing the currently active route auto-expands (computed on both initial boot and every subsequent route change); the rest collapse to a single small-caps header with a ▸/▾ chevron that toggles open/closed on click.

**Implementation notes:**
- Purely a nav-presentation change — no route hashes, render functions, or view logic were touched. Deep links and bookmarks to any `#/...` URL are unaffected.
- New `NAV_GROUPS` array (id/label/hashes) plus `navButton()` and `renderNav()` functions replace the old flat `ROUTES.forEach(...)` loop that used to build the sidebar directly inside `buildShell()`.
- `route()` now also calls `groupForHash()` on every navigation and auto-expands the containing group if it isn't already open (re-rendering the nav in that case); otherwise it just updates the active-button highlight via `setActive()`.
- Group-open state (`navOpenGroups`) is an in-memory `Set`, not persisted across reloads — every fresh page load starts with only the active route's group expanded. (Not persisting was a deliberate scope-limiting choice this session; persisting per-user preference to settings would be a reasonable follow-up if the collapse behavior on reload feels wrong in practice.)
- New CSS: `.nav-group-header` (muted/uppercase in its collapsed state, brighter when open) added to both the mobile bottom-rail and desktop side-rail `.nav` rule blocks.
- Verified: `node --check` on all extracted inline `<script>` blocks passes.

**Known cosmetic follow-up:** a handful of pre-existing `.nav button:nth-child(N)` CSS rules (opacity tweaks that used to mark old group boundaries by position) now target different DOM positions since the nav's internal structure changed. Low-risk and purely cosmetic — worth a visual pass next session, but did not block this change.

---

## 9. Cross-Device Responsiveness Pass, incl. Galaxy Z Fold 5 (new this session)

**Ask:** ensure layout compatibility across modern devices, especially switching between PC and mobile — specifically the Galaxy Z Fold 5, which has two very different viewports on one physical device: an extreme-narrow **cover screen** (~344 CSS px wide, ~23:9, when folded) and a near-square **inner display** (~717–840 CSS px wide depending on orientation, when unfolded).

**Changes made:**
1. **Safe-area-inset padding** — the file previously had zero `env(safe-area-inset-*)` usage. Added to: `.topbar` (top/left/right), `.main` (bottom/left/right), and the `.nav` element in all three of its layout tiers (mobile bottom rail, new foldable side-rail, desktop side-rail). Uses `max(existing-px, env(safe-area-inset-N))` / `calc(existing-px + env(safe-area-inset-N))` so devices without the inset (older phones, PC) are unaffected, while devices with camera cutouts, gesture-nav bars, or rounded/curved edges get properly cleared content.
2. **New breakpoint tier: 600–859px** ("foldable / small-tablet"). Previously there were only two shell layouts — mobile bottom-rail below 860px, and the full 208–232px desktop sidebar at 860px+. The Z Fold 5's unfolded inner screen commonly lands in the 600–859px gap in at least one orientation, which used to mean either a stretched/cramped bottom rail or an abrupt jump straight to the wide desktop sidebar. This tier gives that range its own compact **96px icon-forward side-rail** (small icon + small label, vertical layout) — the same conceptual side-rail as desktop, just narrower, so a fold/unfold transition moves through a sensible middle step instead of jumping between two extremes.
3. **Audited, confirmed already correct, no change needed:**
   - `#app { height: 100vh; height: 100dvh; }` — the `dvh` fallback (which accounts for mobile browser chrome showing/hiding) was already present from an earlier session.
   - No element carries a fixed `min-width` outside its own `@media (min-width: ...)` guard — every wide `width`/`min-width` value in the stylesheet is either a breakpoint threshold or a `max-width` cap, so nothing forces horizontal overflow at the ~280–344px cover-screen extreme.
   - No JS-side canvas/chart width caching exists anywhere in the app (confirmed via grep for `canvas`, `getBoundingClientRect`, `innerWidth`) — the entire layout is CSS grid/flexbox, so a fold/unfold event (which fires as an ordinary browser resize) triggers a correct reflow automatically. No JS resize/orientation listener was needed or added.

**Verification:** `node --check` on all extracted inline `<script>` blocks passes (JS untouched by this pass — CSS/meta only); brace-balance check confirmed clean across all 3 inline `<style>` blocks.

**Not done / explicitly out of scope this session:** true Android fold-aware APIs (the `env(fold-*)` viewport-segments proposals) are not yet standardized/broadly supported and were not implemented — the fix here is viewport-width-based (media queries), which works correctly on the Z Fold 5 today and degrades gracefully everywhere else. If Chrome/Samsung Internet ship stable fold-segment APIs later, revisit whether a hinge-aware two-pane layout is worth adding for tablet-class content (e.g. side-by-side doctrine card + answer panel across the two segments).

---

## 10. Device / Input-Mode Auto-Detection (new this session)

**Ask:** make the app as fluid/flexible as possible across devices and "viewing methods," and let UI/UX adapt to device/mode, not only to screen width.

**Key finding before making changes:** the app already had two existing, deliberate systems worth protecting rather than replacing:
1. A `data-text-scale` system (compact/standard/large/xlarge) giving the person direct control over reading-text size — a viewport-based `clamp()` fluid-type replacement would have quietly reduced that control, so body/reading text was left alone. Fluid-typography treatment was scoped only to considering (not ultimately changing, given low risk/reward at this pass) presentational headings, not reading content.
2. A "Fold 5 unfolded / tablet layout" 768px breakpoint block already present in the source (predates this conversation's sessions — `.panel-grid-2/3`, some heading sizes, `.main` padding) — confirmed it doesn't conflict with last session's 600–859px sidebar tier (§9) since it only touches content-grid/heading rules, not `#app`/`.nav` structure. Left in place as-is.

**What was added — OS-level device-mode auto-detection**, mirroring the app's existing `prefers-reduced-motion` pattern (already honored alongside a manual `reduceMotion` setting):
- `@media (pointer: coarse)` → applies the same 48px tap-target sizing as the manual "large targets" accessibility toggle, automatically, on any touchscreen device — phone, tablet, or a Z Fold in either fold state — without the person needing to find that setting.
- `@media (hover: none)` → neutralizes the `transform`/`box-shadow` hover-lift on the app's known hover-lift components (`.click`, `.panel`, `.card`, `.hotspot`, `.idp-suggest-chip`, `.readiness-tile`, `.topbar-search-btn`). This fixes a well-known touchscreen bug where a tapped element's `:hover` styling can visually "stick" until something else is tapped — reads as a glitch on a phone even though it's correct behavior on a mouse-driven PC. Only the transform/shadow is reset; color/opacity hover cues are untouched, and `:focus-visible` (keyboard navigation) is never touched by this rule.
- `@media (prefers-contrast: more)` → applies the same border/outline/underline boost as the manual high-contrast toggle, automatically, for anyone with that OS-level accessibility preference set.
- `@media (prefers-reduced-transparency: reduce)` → applies the same solid-fill treatment as the manual reduce-transparency toggle, automatically.

In every case, the **manual, in-app toggle still exists and still works** (nothing was removed) — these new blocks just mean the correct behavior now also happens automatically from OS/browser signals the person may already have set for other apps, the same way `prefers-reduced-motion` already worked.

**Audited, no change needed:** the app's card/tile grids (`.score-grid`, `.idp-var-grid`, `.readiness-grid`, and others) already use `grid-template-columns: repeat(auto-fit, minmax(Npx, 1fr))`. That CSS pattern responds to the *grid's own rendered width* — i.e. genuinely available space, sidebar width already subtracted — not the raw viewport width. That already solves the "adapt to true available space, not just screen size" problem natively, so no container-query (`@container`) migration was needed; container queries would have been redundant here.

**Verification:** `node --check` on all extracted inline `<script>` blocks passes (JS untouched — this pass is CSS-only); brace-balance confirmed clean across all 3 inline `<style>` blocks.

---

## 11. Demo Center: Guided Tour + Free Mode (new this session)

**Ask:** a complete, end-to-end wired demonstration covering every section (building on the existing Kiosk Mode), letting the person choose between stepping through guided demos or exploring freely — for their own use and for showcasing GUIDON to someone else.

**What existed before:** Kiosk Mode (`#/kiosk`) already had a reasonable 9-stop guided walkthrough with progress dots and Prev/Next — a good foundation, just incomplete coverage (missing MOS, Money, Health, Resources, Terms, Risk, Author, Settings) and no free-exploration option.

**What changed:**
- **Guided Tour expanded to all 19 real sections** — every entry in `ROUTES` now has a corresponding stop (in the same order as the sidebar's nav groups, so the tour reads like a walk down the sidebar): Home, Train, Board, Doctrine, Terms, Learn, Forms, Write, Counsel, Develop, Risk, MOS Career Center, Money, Health, Transition/ETS, Resources, Progress, Author, Settings. Each stop keeps the existing one-line explanation + "Open →" pattern.
- **New: Free Mode.** Choosing it drops the person straight into the real app at Home, to click around at their own pace — no forced sequence. A persistent **"DEMO MODE" badge with a one-tap Exit button** stays visible in the topbar on every screen while Free Mode is active (new `G.kioskBadge` module: `show()`/`hide()`/`checkOnBoot()`), so whoever's driving — the Soldier themself, or someone they're showing the app to — always has an obvious way back out.
- **Mode picker as the actual entry point**: `#/kiosk` now opens on a two-card chooser (Guided Tour vs Free Mode) rather than jumping straight into the walkthrough. A "choose a different mode" link inside the Guided Tour lets someone switch back.
- **Wired end-to-end from onboarding**: previously, picking "Kiosk / Demo Mode" during onboarding silently built a 3-item action-plan stub and landed on Home — the actual tour/demo system was disconnected from the onboarding choice. `finishKiosk()` now sets `location.hash = "#/kiosk"` so picking Kiosk mode immediately surfaces the real picker. Onboarding's mode-card description was updated to mention both Guided Tour and Free Mode up front.
- **State handling**: the guided-vs-free choice is stored in `sessionStorage` (key `guidon-demo-mode`), not the profile record — deliberately session-local so a page reload mid-demo keeps the Free Mode badge showing (`checkOnBoot()` re-checks on every load), but re-entering Kiosk mode fresh (e.g. a new visitor) always re-asks rather than silently reusing the last person's choice.

**Verification:** `node --check` on all extracted inline `<script>` blocks passes; brace-balance confirmed clean across all 3 inline `<style>` blocks; structural grep confirmed 19 Guided Tour stops and all new functions (`renderModePicker`, `renderGuidedTour`, `G.kioskBadge`) present.

**Known follow-up:** Settings was included as the 19th/final tour stop for completeness against "all sections," but it's arguably not a showcase-worthy stop on its own — worth reconsidering if the tour feels padded in practice; could fold it into the Account-group intro instead of a standalone stop.

---

## 12. Real Rendering Bugs Found & Fixed via Playwright (new this session)

**Trigger:** user shared an actual phone screenshot (Train screen, Kiosk Mode, ~360px Android phone) showing visible topbar overlap and a stray element in the bottom nav.

**Tooling note for future sessions:** this environment has **Playwright 1.56 with a Chromium binary pre-installed** at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. It is not listed among the named tool-belt entries, but it works via `bash_tool` + Python (`from playwright.sync_api import sync_playwright`). This is the correct way to verify any future "does this actually render right" question — load the file with `page.goto("file://...")`, drive it with `page.evaluate()`/`page.get_by_text().click()`, then read real layout with `page.evaluate(() => el.getBoundingClientRect())` / `getComputedStyle()`, and/or `page.screenshot()`. Don't rely on reading CSS in isolation for layout questions — this session's root causes (a flexbox `min-width:auto` gotcha, and a mobile/desktop nav-pattern mismatch) were both invisible from code review alone and only became clear once actually rendered.

**Bug 1 — topbar name-overwrite (pre-existing).** Three code paths wrote a person's full display name directly into the profile icon button's `textContent`, replacing the 👤 icon with unconstrained, overflowing text — the "KIOS/MOD" clipping visible in the screenshot. Fixed with a dedicated `#topbar-username` element (own max-width/ellipsis, hidden below 480px) and repointed all three writers (`boot userName sync`, `onboarding-complete callback`, `cached-profile-load`) to it instead of the icon button.

**Bug 2 — brand title overflowing into the status chip (pre-existing).** The "GUIDON" `<h1>` rendered ~58px wider than its container. Root cause: the brand's text is wrapped in an unclassed `<div>` that is itself a flex item of `.brand` (`display:flex`) — flex items default to `min-width:auto`, which silently overrides any `max-width`/`overflow:hidden`/ellipsis set on a *descendant*, no matter how it's written. Confirmed via `getComputedStyle()` showing `max-width:100%` correctly applied to the h1 while its rendered width stayed at the full unwrapped text width. One-line fix: `.topbar .brand > div { min-width: 0; }`.

**Bug 3 — collapsible nav-group headers leaking into the mobile bottom rail (introduced in session 4).** The grouped/collapsible sidebar nav added in session 4 was only ever validated conceptually for the vertical sidebar tiers; on the horizontal phone bottom-rail, a group-header toggle button (e.g. "▾ Board Prep") rendered inline between destination buttons, which doesn't match how real bottom tab bars work (flat + scrollable, not an accordion). Fixed by branching `renderNav()`: **flat list below 600px**, collapsible groups only at the two sidebar tiers (≥600px). A `matchMedia("(min-width:600px)")` change-listener re-renders the nav live across a resize/fold event.

**Verification performed (not just a code read-through):** rendered and screenshotted the app via headless Chromium across 6 real viewport widths spanning the Z Fold 5 cover screen through desktop (344 / 390 / 412 / 717 / 860 / 1280px) against **all 18 sections** in Kiosk Mode — 108 combinations. A scripted check (`document.documentElement.scrollWidth - window.innerWidth`) found **zero** instances of horizontal overflow anywhere in that matrix, and targeted `getBoundingClientRect()` checks confirmed the specific topbar/nav fixes actually resolved the reported issue rather than just looking plausible in the stylesheet.

**Open question flagged, not resolved:** neither of the two pre-existing bugs (topbar name-overwrite, brand-title overflow) were caught during earlier sessions' responsiveness work (§9, §10) because that work was CSS-review-based rather than rendering-verified. Future device/responsiveness passes should default to a Playwright verification step rather than stopping at `node --check`/brace-balance, which only catch syntax errors, not layout bugs.

---

## 13. Board Drill Rebuilt as Quizlet-Style Flip Cards (new this session)

**Ask:** convert the study-cards section into a Quizlet-style flashcard system — responsive, dynamic, with the polish that format requires.

**What changed:** the "Board Drill" tab (default tab under Board Prep, `#/board`) previously used a "Reveal Answer" button that expanded the answer content *below* the question in the same static card. It's now a genuine flip card:

- **3D flip mechanic** — `perspective` + `rotateY(180deg)` on click/tap/Space/Enter, front = question, back = the full existing answer content (Acceptable Answer, By-the-Book verbatim doctrine answer, key points, cross-links to Doctrine/scenarios) — none of that content was cut, just moved onto a proper "back of card."
- **Deck-progress bar**, **shuffle button**, **star/bookmark** (persisted alongside the existing per-card spaced-repetition record, with a new "⭐ Starred" filter chip that only appears once something's starred), and a **Prev/Flip/Next browsing row** independent of grading.
- **Keyboard shortcuts** scoped to the card container: Space/Enter flip, arrows browse, G/1 and R/2 grade (once flipped).
- **Responsive via `clamp()`** — card height and prompt type scale continuously from phone to desktop; re-verified zero horizontal overflow across the same 6-viewport matrix used in §12.
- **Motion-aware and theme-agnostic** — reuses the app's existing `data-motion="minimal"`/`.reduce-motion` convention to swap-instead-of-rotate for anyone who wants that, and every new color is a theme CSS variable, so all 14 themes render it correctly for free.

**What was deliberately left alone:** the underlying SM-2-lite spaced-repetition engine, the due/leech weighting logic, and the separate Quiz (multiple-choice) and Mock Board tabs — the request was specifically about the study-cards presentation, not the scheduling algorithm or the other tabs.

**Verification:** per the tooling note in §12, this was verified with Playwright rather than just read from the code — scripted clicks confirmed the flip toggles correctly, starring persists and updates the icon, grading "Got it" both advances to a new card and resets the flip state, and the Space/Arrow keyboard shortcuts fire correctly, all with zero console errors. The same overflow scan from §12 was re-run against `#/board` specifically across all 6 viewport widths: zero overflow.

---

## 14. Comprehensive PC/Mobile Audit + Proposal (new this session)

**Ask:** a comprehensive proposal of further improvements, backed by an actual audit across PC and mobile configurations.

**Deliverable:** a standalone document, `GUIDON_AUDIT_PROPOSAL.md`, saved alongside these three canonical files but **not** one of them — it's a one-time audit report, not something amended every session. It covers: accessibility (with real axe-core findings), performance, mobile-specific UX, PC-specific UX, a consolidated view of previously-flagged data-freshness items, and a suggested priority order.

**Methodology — real tooling, not opinion:**
- Ran **axe-core 4.12.1** (installed via npm this session) injected into the live app through Playwright, across 8 of the app's 19 sections, checking WCAG 2.0/2.1 level A + AA rules.
- Findings: **12 unlabeled checkboxes + 2 unlabeled `<select>` elements** (Settings, Board Drill) — critical severity; **79 color-contrast failures across 8 sections** in at least the "Parade Rest" theme — serious severity; **2 nested-interactive-element violations**, both on the new Quizlet flip card from session 9 — serious severity.
- Re-ran the same 6-viewport/19-section overflow + console-error sweep from sessions 8–9: zero issues found (the session 8/9 fixes hold).
- Measured actual load performance (`performance.getEntriesByType('navigation')`): ~320ms parse+load on this test machine, from local disk — noted in the proposal as a best-case number, since the same 4.94MB eager-parsed `GUIDON_SEED` object is a plausible source of first-load jank on older/budget Android hardware that this fast test machine can't surface.

**Fixed immediately (not left as a proposal item):** the nested-interactive violation, since it was a clear, contained regression introduced by this session's own §13 flip-card work — `.qz-card` no longer carries `role="button"` (the keyboard-flip handling already lived on the card's container `cardWrap`, so the role was redundant and, combined with the real `<button>` star icon nested inside, tripped WCAG 4.1.2). Verified fixed via a follow-up axe-core run showing zero nested-interactive violations on `#/board`.

**Deliberately left as proposal items, not silently patched:**
- The unlabeled form controls — mechanical fix, but not applied without confirming scope/priority first.
- Color contrast — explicitly *not* quick-patched. 79 failing nodes trace back to shared `--text-dim`/`--text-mute` tokens reused across dozens of components; a global token change to fix light-theme contrast risks new problems in dark themes. This needs a deliberate per-theme pass, flagged as its own future session rather than rushed.

**Full findings, priorities, and a suggested next-session order live in `GUIDON_AUDIT_PROPOSAL.md` — refer to that document rather than duplicating it here.**

---

## 15. Audit Proposal Implemented (new this session)

**Ask:** implement the recommendations from the session-10 audit (`GUIDON_AUDIT_PROPOSAL.md`), in priority order.

### Critical: all unlabeled form controls fixed
Traced the 12 unlabeled checkboxes to **three separate near-duplicate toggle-switch builder functions** in Settings — `toggle()`, `toggleRow()`, and one standalone Reduce Motion checkbox — each of which put the visible label text in a sibling `<span>` *outside* the actual `<label>` element, so the checkbox's accessible name never resolved. Fixed all three by adding `aria-label` directly to each `<input>`. Also fixed the 2 unlabeled `<select>` elements (Board Drill's category filter, Quiz mode's category filter) and the onboarding tier-filter select the same way.

### High: two systemic root causes found and fixed, not just symptoms
This is the most important finding of the session. Rather than patch each individual low-contrast element, two actual root causes were traced and fixed once each, resolving dozens of symptoms app-wide:

1. **`<meta name="color-scheme" content="dark">` was static** — it can't read a data attribute, so it silently forced native form-control rendering (specifically, unstyled `<button>` text color) to dark-mode defaults *even inside the app's 5 light themes*. This is what caused white text on light "readiness tile" backgrounds on Home, and would have caused the same failure on any other unstyled button in a light theme. Fixed with `html { color-scheme: dark; } html.light { color-scheme: light; }` — CSS wins over the meta tag once parsed, and the pre-paint bootstrap script already sets `html.light` synchronously, so there's no flash. Also explicitly bound `.readiness-tile` to `var(--text)` for exact theme-token consistency rather than relying on the (now-correct) UA default.

2. **Hardcoded dark ink on amber-background buttons assumed `--amber` is always a light accent.** `.btn.primary` and ~8 other components used `color: #1a1206` on `background: var(--amber)` — but 8 of the app's 14 themes (including the *default*, field-manual) use a deep, muted color for `--amber`, not a bright one. Computed actual WCAG contrast ratios (not a luminance shortcut — an initial luminance-based heuristic was wrong for 3 themes; the real math confirmed black beats white for blackout, squadron-blue, and range-red despite their `--amber` looking bright) for both ink candidates against every theme's real `--amber` value, then added a `--btn-ink` CSS variable per theme and repointed 8 components to it: `.btn.primary`, `.segmented button.active`, `.skip-link`, `.grade-btn.active`, `.mb-cat-chip.on`, `.ob-rank-btn.active`, `.cpdf-modebtn.active`, plus two components from earlier *this* session's own work (`.qz-nav-flip`, `#demo-mode-badge` button) that had the identical bug.

3. Also fixed, as smaller isolated items: the `.nav-group-header` opacity-multiplier bug (this was session 4's own regression — an `opacity: .62` stacked on top of an already-dim inherited color pushed 13 of 14 themes below the 4.5:1 minimum; removed the opacity crutch entirely), the topbar subtitle (bumped from `--text-mute` to `--text-dim`), desert-cadence's own slightly-too-light `--text-dim` token value, and two "raw accent color used directly as text" instances (the nav active-item indicator, and the home-screen due-cards urgency count) — both fixed by blending the accent with the guaranteed-readable `--text` color via `color-mix()` rather than using the raw accent.

**Measured result:** color-contrast violations on Home dropped from 67 (measured at the start of this session, across all 14 themes) to 0 in 13 of 14 themes, with 2 minor items remaining specifically in desert-cadence — logged as a follow-up rather than silently left.

### Serious: nested-interactive elements
Fixed both instances found: the Quizlet flip-card's outer container (already addressed in session 10) and a second, previously-undiscovered instance — the home-screen "board cards due for review" panel had a `role="button"` div wrapping a real, separately-clickable `<button>Start drill →</button>`. Removed the redundant outer `role`/`onclick`/`onkeydown` since the inner real button already fully handled the interaction.

### Scope note: full 18-section × 14-theme sweep run, not fully exhausted
Per the proposal's own recommendation, the axe-core sweep was extended from the original 8-section sample to all 18 sections × all 14 themes (252 combinations) — this surfaced substantially more findings than the original sample suggested (443 contrast + 297 other violations measured before this session's fixes were applied), concentrated in: Risk (a cluster of unlabeled worksheet fields — text/date/numeric inputs and ~8 unlabeled selects), Money and Author (unlabeled selects), and Train (card/tag/chip contrast in a handful of the less-common themes). This session fixed the highest-leverage, most systemic issues (above) rather than exhaustively chasing every remaining scattered instance in one sitting — those are tracked as open items for a future pass.

**Verification:** `node --check` on all extracted inline `<script>` blocks passes; brace-balance clean across all 3 inline `<style>` blocks; a final sanity sweep across all 18 sections confirmed zero horizontal overflow and zero console/page errors.

---

## 16. Device Verification: Galaxy Tab S9 FE 5G (new this session — no code changes)

**Ask:** ensure compatibility, flexibility, and fluidity for a specific device (a screenshot of a Samsung device-info screen: "Christopher's Tab S9 FE", model SM-X518U).

**Approach:** rather than guess at what "compatibility" needs, researched the device's actual hardware specs and tested against its *real* CSS viewport, not an approximation.

**Researched specs:** Samsung Galaxy Tab S9 FE 5G (SM-X518U) — 10.9" display, 2304×1440 physical resolution, Android 13 (One UI 5.1), Exynos 1380 chipset. At this pixel density, Samsung tablets in this class report a device pixel ratio of 2 to the browser, giving a computed CSS viewport of **~1152×720 in landscape** and **~720×1152 in portrait**.

**Verification performed:** loaded the app in headless Chromium at those exact dimensions, with a matching Android 13/SM-X518U user agent and touch emulation enabled, across both orientations and all 18 sections. Checked: horizontal overflow (zero), console/page errors (zero), which responsive tier each orientation lands in (landscape → full desktop sidebar at ≥860px; portrait → the compact foldable/tablet sidebar at 600–859px, both appropriate for the device's actual 10.9" size), and that the device/input-mode auto-detection from session 6 actually engages on this hardware profile — confirmed `pointer: coarse` and `hover: none` both correctly evaluate `true`, with nav buttons automatically receiving 48px touch sizing with zero manual configuration. Visually spot-checked Home, the Quizlet-style Board Drill flip card, and the MOS Career Center in both orientations.

**Result:** the device renders cleanly with no issues found. **No code changes were made** — the responsive and device-mode work from sessions 5 (foldable/cross-device breakpoints), 6 (pointer/hover auto-detection), 9 (Quizlet flip-card responsiveness), and 11 (contrast fixes) already generalizes correctly to this specific real device without any further changes needed. `guidon_40.html` remains the current, verified build.

---

## 17. Tab S9 FE Hardware Optimization: S Pen Hover + 90Hz Audit (new this session)

**Ask:** optimize for this specific tablet's maximum capacity/capabilities, following session 12's device verification.

**Approach:** rather than generic "make it feel premium" polish, identified what this device *specifically* offers beyond a plain touchscreen and built to that.

**Researched:** the Galaxy Tab S9 FE ships with an included S Pen (pressure- and tilt-sensitive, with genuine hover-above-glass detection — the pen is sensed by the digitizer before it touches) and a 90Hz adaptive-refresh display. Also confirmed Samsung DeX exists on this model but cannot output to an external monitor (its USB-C port is USB 2.0 only, no video-out) — so a dedicated "DeX desktop mode" layout wasn't built; the existing ≥860px sidebar tier already serves windowed/DeX use well.

**S Pen hover — the genuinely new capability added this session.** `(hover: hover)` and `(pointer: fine)` CSS media queries describe a device's *primary* pointer only. On a tablet, that's touch — so even though this specific device's bundled pen has true hover detection, GUIDON's existing mouse-only hover-lift rule structurally could never see it; a Soldier using the S Pen would get zero pre-touch feedback on something a mouse user takes for granted. Fixed by adding JS-level pointer detection (`pointerType === "pen"`) on the Board Drill flip card via the Pointer Events API — `pointerenter`/`pointerleave` toggle the same lift-and-glow class a mouse `:hover` gets. This is scoped tightly: verified via dispatched `PointerEvent`s that touch does *not* trigger it (stays correctly touch-only elsewhere), and that it stops the moment a card is flipped (no stale hover state lingering into the answer view).

**90Hz smoothness — audited, confirmed already correct, nothing to change.** A 90Hz panel only delivers its extra smoothness if animations avoid layout/paint-triggering CSS properties. Checked the flip card's transition and confirmed it animates only `transform` — already fully GPU-compositable, a decision made back in session 9 without this device specifically in mind, but it happens to be exactly right for this one too.

**Verification:** `node --check` passes; brace-balance clean across all 3 style blocks; full 18-section sanity sweep at the device's real 1152×720 viewport shows zero overflow / zero console errors; S Pen hover logic verified via real dispatched `PointerEvent`s covering hover-in, hover-out, touch-non-triggering, and post-flip states.

---

## 18. Pre-Demo Hardening Pass (new this session)

**Ask:** audit for remaining gaps, fix and harden as much as possible, without breaking anything — same-day showcase to other people.

**The one real bug found — and it was exactly where it would have hurt most.** Simulated precisely what a presenter does today: start the Guided Tour in the Demo Center, tap "Open →" to visit a stop, then press back to return to the tour. Found that this silently reset the tour to step 1 instead of resuming — `renderKioskMode` rebuilds fresh every time `#/kiosk` is visited, and the tour's step position lived only in a function-local variable with no persistence across that rebuild. Fixed by persisting the step to `sessionStorage`, mirroring the existing guided/free mode-choice persistence pattern from session 7. Cleared appropriately when someone chooses a different mode, ends the tour, or a fresh visitor enters kiosk mode (so a new person doesn't inherit a stranger's leftover position). **Verified by scripting the entire 19-stop walkthrough** — open a stop, press back, confirm the tour shows the correct stop, repeated for all 19 — all correct, zero errors.

**Closed every remaining item from session 11's audit follow-up list:**
- Risk Assessment worksheet (5 text/date inputs, 8 selects), Money page (5 calculator inputs), and Author page (1 select) all had the same disconnected-`<label>` pattern found and fixed repeatedly earlier in the project — fixed identically with `aria-label`.
- Board Drill's scrollable answer region is now keyboard-focusable, closing the last `scrollable-region-focusable` violation.
- **Verified result: zero non-contrast WCAG A/AA violations anywhere in the app** — the full 18-section × 14-theme matrix (252 combinations) now returns clean on every rule except color-contrast.

**Contrast: found and fixed one more systemic gap via the ripple effect of the day's `.hint` fix.** `.hint` — used for helper/explanatory text on nearly every screen — was using `--text-mute`, which fails 4.5:1 in 12 of 14 themes; bumped to `--text-dim` (the same proven fix pattern from earlier work). Also found and fixed a subtler case: the Develop/Risk sidebar icons sat right at the ~4.5:1 line by flat-color math, but failed axe-core's stricter anti-aliased-pixel sampling on those particular glyph shapes — gave nav button text a small `color-mix()` contrast margin to clear it with headroom. **Total contrast violations across the full matrix dropped from 443 to 221.** The remainder are scattered 1–6-count near-misses spread across several themes and pages — logged as a follow-up rather than exhaustively chased today, given the same-day timeline.

**Confirmed solid, not broken:** ran the complete Personal Account onboarding path end-to-end (name → role → mood → focus areas → generated action plan → save) via script — completes cleanly with zero errors. One suspected bug (the "enter your last name" validation toast appearing not to fire) turned out to be a test-timing artifact on this session's part, not an app issue — confirmed working correctly on a tighter-timed recheck.

**Verification:** `node --check` passes; brace-balance clean across all 3 style blocks; full regression sweep across 4 viewports (phone, tablet portrait, tablet landscape, desktop) × 18 sections: zero overflow, zero console errors; complete 19-stop Guided Tour walkthrough with back-navigation tested at every stop.

---

## 19. Quick Full-App Audit + Hardening Pass (new this session)

**Ask:** a quick look-over of the entire app, fix/harden/polish everything, then a post-audit report + updated build.

**Approach:** re-ran the established axe-core sweep (18 sections × 14 themes, 252 combinations) to get an exact current baseline, then looked for the *pattern* behind the remaining failures rather than fixing each one individually again.

**Root cause found:** a repeated habit across the codebase of using a raw accent color (`var(--amber)`, `var(--red)`, `var(--cyan)`, etc.) directly as text, or blending it only 65% toward the guaranteed-readable base text color. That 65% figure was set earlier in the project and looked safe against the themes it was checked against at the time — but wasn't enough once verified against all 14. Rather than raise it theme-by-theme again, strengthened every instance from 65%→40% blend weight in a single pass: Train's difficulty and competency badges, search-filter chips, danger buttons, the nav sidebar's active-state indicator, and the nav sidebar's base (inactive) text color — 14 call sites total. Verified empirically against axe-core (not just recomputed by hand) that this actually resolves the previously-failing combinations, since earlier sessions had shown the flat-color math and axe's stricter anti-aliased-pixel sampling don't always agree.

**Measured result:** contrast violations across the full 252-combination matrix dropped from 221 to 104 this session (77% down from the original 443, across sessions 11/14/15 combined). Non-contrast violations remain at zero, as they have since session 14.

**What's left:** roughly 104 minor near-misses, concentrated in three warm/tan-paletted themes (desert-cadence, sepia-study, field-manual) where several tokens sit close to the 4.5:1 line. Not chased further this session — the "quick audit" framing of this request, combined with clearly diminishing returns per additional fix, made this the right place to stop and hand off as a tracked item rather than open-ended perfectionism.

**Re-confirmed nothing broke:** the full 19-stop Guided Tour walkthrough (including the back-navigation resume behavior fixed in session 14) still works correctly; the Board Drill flip card's flip/star/keyboard interactions still work; zero layout overflow or console errors across 4 real viewports × 18 sections.

**Deliverable:** `GUIDON_POST_AUDIT_REPORT.md` — a concise before/after summary, deliberately shorter than session 10's full `GUIDON_AUDIT_PROPOSAL.md` to match the "quick" scope of this request.

---

## 20. Board Card Audit + Difficulty Tiers + 4-Level Mastery Grading (new this session)

**Ask:** audit all 1,031 board cards for duplicates, split them into beginner/intermediate/expert (by-the-book verbatim) study levels, and upgrade the flip-card grading into a 3–5-level mastery system with a bookmark deck.

**Duplicate audit — real methodology, not a guess.** Extracted the full 1,031-card corpus and ran exact-match plus fuzzy-match (Python `SequenceMatcher`, 0.82 similarity threshold) comparison across every question. Manually checked every match's actual answer content before deciding — this mattered, because several high-similarity pairs (e.g. "What is ADP 3-0?" / "What is ADP 6-0?") were sentence-template-similar but factually distinct, and were correctly kept rather than removed. **17 confirmed true duplicates removed, 1,031 → 1,014.** Two of the removed pairs were also data-quality issues beyond simple duplication: one had outright conflicting answers to the identical question, and one was labeled "seven principles" while listing six. Full before/after table lives in the new `GUIDON_BOARD_CARD_AUDIT.md`.

**Difficulty tiers added to all 1,014 remaining cards** — none existed before this pass (a difficulty filter seen in an earlier screenshot turned out to belong to the Train/scenario browser, not Board Drill, on closer inspection). Built a transparent heuristic (category type, answer length, key-point count, question phrasing) rather than hand-grading 1,014 cards individually: **324 Beginner, 597 Intermediate, 93 Expert**. Documented in the seed data's own `note` field and in the audit doc as heuristic-based, not authoritative — consistent with how the app already flags its other auto-generated content.

**"Expert" is tied to actual verbatim-recall behavior, not just a label.** `buildBackContent()` now checks `q.difficulty`: Expert-tier cards flip to show the **By-the-Book verbatim answer first**, ahead of the paraphrase-friendly Acceptable Answer — the tier is meant to hold you to word-for-word doctrine, not just a harder-sounding badge. Beginner/Intermediate keep the original paraphrase-first order. Every card's front face now also shows a small colored tier badge (🟢/🟡/🔴) before it's even flipped, and a **Level** filter sits next to the existing Category filter in the toolbar.

**Grading rebuilt from binary to 4-level.** `schedule()` (the SM-2-lite spaced-repetition function from session 9) previously took a boolean. It now takes a 0–3 grade — **0 Needs Help, 1 Somewhat, 2 Know It, 3 Down Cold** — each with its own ease/interval curve (Needs Help fully resets and resurfaces immediately; Somewhat holds progress but comes back tomorrow; Know It matches the old "recalled" path; Down Cold grows the interval faster than Know It, rewarding real confidence). Accepts a legacy boolean too (`true`→2, `false`→0) so nothing else calling it breaks. The card back's two buttons became four (color-coded, grid-laid-out); the existing swipe gesture now maps to the two most common outcomes (right = Know It, left = Needs Help) since a swipe can only carry a binary signal; and the keyboard shortcuts changed from G/R to plain **1–4** number keys, one per grade.

**Bookmark deck**: the star system from session 9 already did what was asked (persist a starred flag per card, filter to starred-only) — relabeled the filter chip "⭐ My Bookmarks" to make that framing explicit rather than building a second system.

**Verification:** data splice verified via `node -e` round-trip (1,014 questions load correctly; difficulty distribution matches; the unrelated 3,592-term acronym dictionary confirmed untouched); `node --check` passes; brace-balance clean; full regression sweep across 4 viewports × 18 sections shows zero overflow/console errors; axe-core check on a flipped Board Drill card shows zero violations; all 4 grade buttons, the 1–4 keyboard shortcuts, the difficulty filter, and the bookmark filter were each individually exercised end-to-end via script (one Playwright timing flake during testing did not reproduce on a clean re-run, confirmed rather than assumed).

---

## 21. Team Review: Connected Grading to Progress, Fixed a Pre-Existing Bug (new this session)

**Ask:** a multi-angle team review of the app (holistic + minutiae), a read-through of the handoff, strong recommendations, then implement them all and harden/polish what's touched.

**Finding 1 — the session 16 grading system was an island.** The 4-level mastery grades and difficulty tiers built last session only ever surfaced as a live session tally on the Board Drill screen itself; the Progress tab had zero connection to any of it. Added a **"Board Drill Mastery" panel** to Progress: per study level (Beginner/Intermediate/Expert), what share of graded cards are Know-It-or-better versus still-needs-work, computed from each card's `lastGrade` and `difficulty` fields.

**Finding 2 — a genuine pre-existing bug, found while wiring in Finding 1's fix.** Progress had a hard `return` that hid every piece of card-progress content — including the "Board Q Readiness" per-category panel that predates this session entirely — behind a gate requiring at least one completed Train scenario. Someone who exclusively drills Board Drill flashcards (a completely normal usage pattern) saw a blank "no attempts yet" screen no matter how much progress they'd actually made. **Verified this predates today's work** by reproducing the identical gap against yesterday's build (`guidon_43.html`) before writing a fix, rather than assuming. Fixed by removing the blanket early return — the scenario-specific sections further down (trend chart, action plan) already guard themselves against missing data individually, so nothing else needed to change.

**Finding 3 — nav sidebar group state, flagged since session 4, never fixed.** Persisted to `localStorage` now; restored on load, saved on every manual toggle.

**Considered and deliberately deferred, with reasoning recorded rather than silently dropped:**
- Lazy-loading the ~5MB embedded seed object for lower-end mobile hardware — still a good idea, but real surgery on the single-file loading path; deserves its own focused session rather than being squeezed in here.
- Extending the 4-level SRS grading to Quiz Mode / Mock Board — those are multiple-choice testing, a different interaction paradigm that doesn't need flashcard-style mastery grading; a difficulty *filter* there (matching Board Drill's) would be a reasonable smaller follow-up.
- The web app manifest for installability — still valid, still not urgent.

**Verification:** `node --check` passes; brace-balance clean; full regression sweep across 18 sections: zero overflow, zero console errors; Guided Tour spot-checked post-change; the new mastery-panel logic confirmed sound via direct IndexedDB inspection (`lastGrade`/`difficulty` fields load and compute correctly — it renders now that the gating bug is fixed); nav-group persistence verified via `localStorage`.

---

## 22. The Actual Reason Progress Never Showed Board Data (new this session)

**Ask:** a focused follow-up to session 17 — "just wire the new grading into Progress."

**What last session got wrong, and how this session found the real bug.** Session 17 shipped the "Board Drill Mastery" panel and removed a suspected blocking early-return in Progress, reasoning through several hypotheses along the way — but the panel still never actually rendered, and that session's own testing never caught it, because its Playwright test scripts filtered console output to `msg.type === "error"` only. The actual failure was logging via `console.warn`, which that filter silently discarded across two full sessions' worth of investigation.

**This session, re-testing with the warning channel captured, found the real cause on the first attempt:** `ReferenceError: db is not defined`, thrown every single time the Progress module tried to read a card's spaced-repetition record. The module's IIFE destructures its dependencies from the global `G` object like every other module in the file — `const util = G.util, store = G.store, el = util.el;` — but this one line never included `db = G.db`. Since `db` is itself a `const` scoped privately inside a *different* module's IIFE (not a real global), referencing bare `db` inside Progress's own scope was always going to throw.

**Consequence, once understood:** this wasn't just breaking this session's new panel. The pre-existing **"Board Q Readiness" per-category panel — which predates this project's entire session history** — has silently failed on every single page load, in every session, for as long as it's existed. It was caught by its own `try { ... } catch(e) { console.warn("board progress:", e); } ` and simply never shown, with no visible symptom beyond a console warning nobody happened to be listening for at the right filter setting.

**Fix:** one line — `db = G.db` added to the existing destructuring statement.

**Verification, not assumption:** graded 8 Board Drill cards spanning all 4 grade levels, navigated to Progress, and confirmed **both** panels now render with real, correct numbers — the new Mastery-by-study-level panel *and* the older per-category panel, the latter working for what appears to be the first time in this app's recorded history. Re-ran the full 18-section regression sweep with both `error` and `warning` console channels captured this time: zero overflow, zero errors, zero warnings anywhere in the app.

**Lesson logged for future sessions:** when a "fixed" bug doesn't actually resolve on retest, don't just try a second hypothesis on top of the first — re-check the *test itself* for a false negative, especially around console/error capture filters. That's exactly what happened here.

---

---

## 23. Branch Merge — Reconciling a Parallel Fork (session 19)

**The project forked without anyone noticing.** Two chats both continued from `guidon_40.html`, each running their own sessions 13–14 and producing two different `guidon_41`/`guidon_42` files. Both branches independently performed accessibility and contrast work — the Risk/Money/Author unlabeled-control fixes and the `qz-back-scroll` keyboard fix were each done **twice, in parallel, unaware of each other**.

**Resolution:** the other branch had advanced much further on features (sessions 15–18), so `guidon_46.html` was adopted as the base and only genuinely-unique work was ported forward into `guidon_47.html`. Nothing was reverted.

### Why the merge paid for itself
`guidon_46` still carried a real bug this branch had already diagnosed: the stale `.nav button:nth-child(4/11/16/17)` rule, orphaned by the session-4 nav reorganization. Post-reorder it lands on the **Career and Author nav buttons and the `.nav-group-header` elements**, dimming them to `opacity: 0.72`. Measured live via axe-core, that one dead rule caused **37 of 50 remaining contrast violations (74%)**, worst case **2.93:1**.

### Ported forward
| Item | Closed which open item |
|---|---|
| `--ink-*` text-safe accent tokens | remaining warm-theme contrast near-misses |
| Inline `data:` web app manifest | open item #5 ("installability — still not done") |
| `APP_VERSION` + Settings About panel | long-standing "no single version marker" |

**Result: 50 → 0 contrast violations** across the three flagged warm themes × 8 sections; zero errors, zero warnings, zero overflow.

### Expert-tier spot-check (open item #1)
All 93 Expert cards were read. The heuristic is broadly sound but **over-weights category** — it treats LOAC, UCMJ, Financial Readiness and Supply & Property as inherently expert, so simple definitional questions inside those categories get mis-tiered. Six unambiguous cases were reclassified (acronym-expansion and basic-training recall down to beginner/intermediate). New distribution: **327 / 600 / 87 = 1,014**, total preserved. Deliberately conservative — this is someone's study material, not a dataset to optimize.

### A defective instrument, reported not used
A looser duplicate re-scan was attempted to test whether session 16's 0.82 threshold under-caught. It reported "84 clusters / 204 cards" — **and was wrong.** It clustered on sentence template rather than meaning, grouping `General Order 1/2/3` and `Class 1/2/3 leak` as duplicates and lumping every `What is the difference between X and Y?` card together regardless of topic. **Session 16's stricter threshold plus hand-verification was the correct methodology.** No cards were removed. One genuine residual cluster (~5 cards on *Commander's Intent*) is reported for human review.

### The pattern, now three occurrences deep
Two of this session's own verification results were **false negatives caught before acting on them** — the Progress Mastery panel is correctly gated on graded data, and nav persistence writes to `guidon-nav-open-groups` on toggle. Both were fine.

> **Standing rule: when a result is surprising, verify the verifier before forming a hypothesis about the code.**

Occurrences to date: session 13 (harness set `data-theme` without `html.light` → phantom regressions), session 18 (console filter dropped `warning` → hid a `ReferenceError` for two sessions), session 19 (dedup scan over-clustered; two false-negative feature checks). **In this project the test has been wrong more often than the app.** Capture `warning`-level console output by default, and prefer stricter matching with hand-verification over looser automated matching.

---

---

## 24. Onboarding & Profile-Guidance Audit (session 20)

**Verified intact, live:** onboarding modal on fresh profile; 3 modes (Personal/Guest/Kiosk); 5-screen flow; rank→tier mapping via `RANK_TO_TIER`; IndexedDB persistence surviving reload; topbar username; settings `userName` sync; MOS pre-fill into Career Center; Home greeting + plan surface.

**Bug found: new personal profiles lost their action plan at creation.**
`setSetting` intentionally clears `actionPlan` when `etsDate`/`tierFilter`/`retirementSystem` change. The onboarding save handler calls `setSetting` on all three *right after* building the plan — so the invalidation fired on unchanged values and wiped it every time. Guest/Kiosk were unaffected only because they never call `setSetting`.

Bisected by hooking `G.db.put`: `saveProfile → plan:6`, then `setSetting → plan:0` twice. The summary screen's own "6 items built from your answers" text proved the generator was healthy, isolating the fault to the save path.

- **Fix 1** — invalidate only when the value actually differs from what's stored.
- **Fix 2** — `renderProfileView` never regenerated an empty plan despite the comment promising it would; added real regeneration, which also self-heals already-broken profiles.

**Instrument errors: two more** (`offsetParent` is `null` for `position: fixed`; a click selector matching a text-containing wrapper; a 4-iteration loop for a 5-screen flow). **Project running total: the test has been wrong on five separate occasions.** The standing rule in §23 continues to earn its place.

---

---

## 25. Board Date: Profile-Bound, With a Display Choice (session 21)

**Already existed:** board-date input + countdown banner on Board Prep, stored in global settings.
**Added:** a display choice, and binding to the chosen profile.

- **`boardDateDisplay` (`countdown` | `date`)** with an in-banner toggle. A live countdown motivates some people and stresses others — made it a choice. Urgency colour (red ≤3d / amber ≤14d / green beyond) preserved in both modes.
- **Profile-bound:** `boardDate` and `boardDateDisplay` sync into the profile record; the countdown reads **profile-first, settings-fallback**. Guest/kiosk unchanged. Added `G.profile.cached()` — a synchronous accessor, needed because the countdown renders synchronously.
- **Board date now drives the action plan.** Wiring it into the profile-sync hook made it inherit plan-invalidation, but `generateActionPlan` never read `boardDate` — so changing the date wiped a good plan and rebuilt an identical one. Fixed by making it meaningful: ≤7 days → Mock Board today + final uniform/packet/DA 3355 checks; ≤30 days → daily cards, weekly mock, recheck points; beyond → build the habit. Verified 6→8 items at 5 and 20 days out, 7 at 120. Display-mode changes never invalidate the plan.

**Process note:** an early grep for the board-date code matched inside the embedded 3,592-term acronym dictionary and dumped thousands of lines — repeat of a session-14 mistake. **Anchored, narrow patterns are mandatory when grepping this file**; its multi-megabyte inline data blob will match almost any loose term.

---

---

## 26. Account Management, Anonymity, and the Call-Sign Roulette (session 22)

**Account panel, top of the profile view.** Previously two small ghost links at the *bottom*, one labelled "Switch account / mode" that actually **deleted** the profile. Now a bordered panel showing current name + mode with four separated actions:

| Action | Behaviour |
|---|---|
| ✎ Rename | identity only — **action plan preserved** (verified 6 → 6). Blank input ⇒ anonymous. |
| ↺ Redo my setup | re-runs onboarding on the same account, for shifting priorities |
| ⇄ Switch account or mode | genuinely starts fresh at the mode picker; confirm states what is cleared |
| ✕ Delete profile | visually separated, **double-confirmed** (dismissing 2nd confirm verified to abort) |

A "👤 Manage account" signpost was added in Settings → About — that's where people look, but the controls belong with the profile.

**Name is optional.** Rank and tier drive all guidance, so anonymity is a first-class outcome, not a fallback: blank ⇒ profile is `SPC` (rank only), flagged `anonymous`, and labelled as such. Important on shared/unit-issued devices.

**Call-sign roulette.** 🎲 beside the name field, 34 entries, no immediate repeats. Roster is affectionate, not cutting — *Snuffy*/*Joe* are the classic generic-Soldier stand-ins (GI Joe = Government Issue Joe), *Schmuckatelli*/*Snafu* the same joke in other eras, *Dogface* the self-appointed WWII infantry name. Terms mocking new or failing Soldiers (Cherry, Boot, Bolo) and cruder barracks acronyms deliberately excluded. `SOLOMON` placeholder retired.

**Pre-existing bug found by auditing a page nobody had audited.** `#/profile` had never been in an a11y sweep. Doing so exposed `.ob-avatar` hardcoding `color:#000` on an `--amber` fill — **2.55:1** on field-manual. Same class as the session-11 button-ink bug; repointed to `--btn-ink`. **Instinct blamed the new red Delete button; the axe output named a different selector.** Checking before fixing is what kept this from becoming a wrong fix — the standing rule in §23 again.

**Coverage lesson:** the audit matrix had silently excluded `#/profile` and `#/kiosk` for many sessions. Section lists in test harnesses should be derived from `ROUTES`, not hand-maintained.

---

---

## 27. Promotion Points Rebuilt + PPW Worksheet (session 23)

Implements the correction identified by session 22's research. **`GUIDON_PROMOTION_RESEARCH.md` is the sourcing document for every figure here.**

**Rank-aware caps — the detail most calculators get wrong.** SGT and SSG have different maximums, so one Soldier has two totals: training 280/230, awards 145/165, military education 240/245, civilian education 135/160 — each summing to 800.

**Board-score category removed.** Leadership points are gone from the semi-centralized system (SSG = Yes/No validation vote; SGT = admin points only). The surviving 150 points are a **BLC/ALC graduate bonus outside the 800 ceiling**, modelled as an add-on.

**Two modes:** *Quick estimate* (four inputs) and *Full PPW* (line-by-line — weapon hits, AFT points, awards, combat-zone months, resident weeks, correspondence hours, PME honours, Ranger/SF/Sapper, semester-hour points, degree, credentials, CLEP, DLPT).

**Honesty boundaries held deliberately:**
- Weapon points interpolated between the two *published* anchor values and labelled an estimate — unverified table rows were not fabricated.
- Civilian semester-hour rate was never verified, so it is a **direct entry from the Soldier's PPW**, not a guessed formula.
- AFT takes **points, not raw score**, with an explicit warning that score ÷ 5 is wrong — IPPS-A does the conversion.
- **No per-MOS cutoff numbers are shipped.** They change monthly and would be wrong within 30 days. The app explains the mechanism and the 24/798 codes instead.

**Bug found while building: two calculators disagreeing.** A second, older calculator in the profile view still read the outdated seed. Seed corrected, board-score category dropped from it, labelled as SGT caps, and given a "→ Full PPW worksheet" link. One source of truth.

**Verification was arithmetic, not visual** — caps hand-checked per rank (20 combat-zone months → 30 for SGT, 40 for SSG; 500 correspondence hours → 90; BLC bonus 280 subtotal → 430 total).

---

---

## 28. Doctrine Currency Pass + BLC Prep Module (session 24)

### Doctrine currency
Corpus scale: **299 distinct publications, 7,245 mentions.** Full verification is not a one-session job; prioritised by staleness risk instead. **Two sourced corrections made; nothing else touched.**

| Was | Now | Source |
|---|---|---|
| "six events of the ACFT" (incl. Standing Power Throw) | **five events of the AFT**, max 500, 60/event floor | AFT replaced ACFT 1 Jun 2025 |
| "465+ exempts from taping" (×4) | **No AFT-score exemption** — AD 2026-13 rescinded AD 2025-17 | effective 7 Jul 2026 |

The app previously **contradicted itself** — one card said the SPT was removed while `acft-events` still asked for six events.

**Left alone deliberately:** ~212 remaining ACFT references. Many are legitimately historical. Bulk replace across a 7,245-mention corpus without reading context would inject more errors than it removed. Logged as scoped follow-up.

### BLC Prep (`#/blc`, Leadership group)
For E-4(P) and CPL. Seven collapsible sections: what BLC is (NCOPDS gate, 1059 outcomes, Commandant's List 20 pts / DHG 40 pts, +150 bonus) · before you go (administrative failures cause more problems than academic ones) · the academic load (the two graded written products) · what cadre actually watch (behaviours, not checkboxes) · sharpen the sword (needs no slot or permission) · if you are a Corporal (different standard applied, fairly or not) · after BLC.

Plus a **10-item readiness self-check** persisted to IndexedDB (`guidon:blc:checks:v1`), with cross-links to Board Drill, Counseling, Army Writing and the PPW.

Closing note states plainly that course length and packing lists vary by NCO Academy — confirm with S-1.

---

---

## 29. ALC Prep Module + SLC Forward-Look (session 25)

New section `#/alc` under Leadership, mirroring §28's BLC module. Official NCO-C3 course descriptions (supplied by Chris) are the authoritative spine. **Public doctrinal / published course information only** — nothing unit-specific or sensitive.

**The structural fact most Soldiers get wrong:** ALC is *two* courses. Phase I = branch-immaterial NCO-C3 common core (typically virtual), Phase II = MOS-specific technical track (resident). Phase I gates Phase II. Total length **~2 to 55 weeks** by track. Pin-on requirement for SFC; +150 promotion points for graduates recommended for SSG.

**HRC seat prioritisation** (more eligible NCOs than seats): SSG w/ technical track → all SSG → SGT(P) w/ technical track → all SGT; date of rank within tier. Practical read surfaced in-app: **finishing the technical track early moves you up a whole tier.**

**Sections:** what ALC is · getting a seat · what NCO-C3 covers (LRM, servant leadership, mission command philosophy, persuasive essay, military briefing, MDMP → squad-level operations) · the step up from BLC · sharpen the sword · after ALC · looking ahead to SLC (be-know-do, analytical essay, platoon training & leader development plans, mission command *systems*, pin-on gate for MSG).

**Doctrine currency closed:** the Army **eliminated the DLC I–VI requirement for resident NCO PME effective 1 Oct 2024** (DLC, formerly SSD, had gated PME since 2010). Stated plainly in-module because Soldiers are still being told they need DLC II first. Closes a §28 open item.

10-item self-check on its own key (`guidon:alc:checks:v1`), **verified independent of BLC's**. BLC now cross-links forward to ALC, completing the NCOPDS ladder in-app.

*Test artefact:* an initial check reported the DLC note missing — it was present, the test had only expanded a different section. Confirmed by source inspection rather than assumed. Sixth instance of the standing §23 rule.

---

---

## 30. SLC & Senior NCO Path; PME Transformation Caveats (session 26)

**The finding that shaped the build:** the Army's NCO PME transformation is **in execution**, not proposed. Course lengths are moving across the whole ladder — which meant **§28's BLC module and §29's ALC module had already gone stale** and were caveated in this pass.

| Course | Change |
|---|---|
| BLC | lengthened (reporting 5–6 weeks), new land navigation content |
| ALC / SLC | both shortened — **sources disagree** (~3 weeks vs "more than a week" reduction); module says so rather than picking one |
| MLC | expanded 15 → 21 days |
| SMC resident | unchanged at 10 months |
| SMC distance learning | 18–24 months → ~12 months |
| All SGMs | 72-hour warfighting exercise, Fort Bliss |

**New section `#/slc` — "SLC & Beyond"**, eight sections, opening with the PME-change warning so nobody plans around a stale number.

SLC: third NCOPDS course, branch-specific, SSG(P)/SFC, platoon-and-company scope, pin-on for MSG. NCO-C3 uses **be-know-do** (vs ALC's LRM). The writing section draws the distinction that actually matters — persuasive takes a position; **analytical follows the evidence even to an unwanted conclusion**. APA required at some academies.

**MLC:** branch-immaterial, SFC→MSG/1SG, tactical→operational transition. **MDMP newly introduced** (was not previously in the course), three-day ~24-hour warfighting capstone applying MDMP steps 1–3 in a 1SG context; revised curriculum adds explicit 1SG responsibilities on graduate recommendation.

**SMC:** capstone, resident 10 months, DL → ~12 months, Fort Bliss warfighting exercise, conditional promotion for MSGs in higher graded positions.

**Ladder now walkable end-to-end in-app:** BLC → ALC → SLC → MLC → SMC, cross-linked both directions. Three independent self-check keys, verified not to bleed.

*Test artefact (7th instance of the §23 rule):* a check reported SLC not loading — the heading is CSS-uppercased and the probe was case-sensitive. Confirmed via `textContent` vs `innerText`.

---

---

## 31. BLC Module Rebuilt from the ISAP (session 26, part 2)

**Source:** the actual **BLC Individual Student Assessment Plan** (NCOLCoE, 600-C44, Oct 2020) — the grading instrument itself, supplied by Chris. §28's module was written from general knowledge; this is built on the rubrics. **12,894 → 25,949 chars; 7 → 17 sections; 10 → 12 self-check items.**

**What only the ISAP could provide:**
- Six GPA assessments named (1009S brief · two 1009W essays · individual training · PT · squad drill). **Late without coordination = zero.**
- **1009A**: 6 attributes × 4 modules × 25 = 600 max; **480 gates** Commandant's List. Two "Did Not Meet" in blocks f–k ⇒ Failed to Achieve Course Standards.
- Honours: DHG 40 pts · **DLA 40 pts** · C-List 20 pts (top 20%) · Honor Grad / Writing Award / Iron Soldier 5 each. **Any negative counseling disqualifies all six.**
- 1009S is **not Q&A** — clock stops when you ask for questions.
- Writing rubric: Purpose (Advanced = main point in **top 2%**), Analysis (**~80% analysis / 20% summary**), Syntax, Concision, Accuracy.
- Rubric mechanics: individual training 25 steps −4 each; PT **all-or-nothing** per step + hard-copy **DA 2977**; squad drill 20 steps −5 each.
- Reassessment: **max two**, capped at **70%**, **removes honours eligibility**; disenrollment bars NCOPDS **six months**, re-enrollees restart.
- SHARP essay disclosure ⇒ **unrestricted report**.

**Stale bits corrected** (own section, "What has changed since the ISAP was written"): grader rubric still lists **SPT + Leg Tuck** (LTK→Plank 2022; SPT dropped with AFT 1 Jun 2025) · SSD/DLC prerequisites eliminated 1 Oct 2024 · AD 2020-06 protections expired 31 Mar 2022 · ABCP exemption rescinded 7 Jul 2026 · BLC lengthening with land nav under PME transformation.

**Practitioner advice** kept in its original register — sanitising it would remove what makes it land. DLA carries more weight than C-List or DHG; follow the rubric; be creative; slow the PRT cadence; volunteer for a leadership role.

**Test artefact, 8th instance — nearly caused a wrong fix.** Pre-compaction sweep reported 2 night-vision contrast violations on `#/home`. Non-reproducible in isolation. Cause: **150ms settle against a `transition: color 0.15s`** — axe sampled mid-transition. Identical sweep at 400ms: **0 violations**. Fixing on that evidence would have altered working code to satisfy a stopwatch. **Settle longer than the longest CSS transition before sampling colour.**

---

---

## 32. ALC Practitioner Advice (session 27)

New **"From people who have been there"** section (11 points) in the ALC module, matching §31's BLC treatment. Self-check 10 → 12.

**Lead item, most often missed: classroom participation is graded.** Own self-check line. Speak in every discussion including disagreement; bring experience, not the reading.

Also encoded: instructors watch outside graded events · **AFT feeds the Presence rating on the 1009A → DA Form 1059** (second new self-check item; source said "1059A", corrected — 1009A is the assessment, DA 1059 is the AER it feeds) · **plagiarism = dropped** · **write how you speak** (an NCO was marked down for "labyrinth" and "purview"; SGL said stop googling vocabulary — clarity scores, performance does not) · 0630–1800 days, open bay, use the study block · **a former instructor's warning that coasting and competing look identical from the inside** · the peer-sniping dynamic and why it costs the sniper · slide-polishing culture, met quickly rather than indulged.

**Editorial decision, made openly.** Source used a disability slur and a crude sexual jibe. **Observations kept, language reworded** — this app gets shown to units. The section states it has been reworded so it is not mistaken for verbatim quotation. Nothing substantive softened: "you will be dropped," the coasting warning, and the sniping dynamic all survive intact.

Verified: 10 sections, 13 content probes, **automated slur check clean**, self-check independent of BLC, **0 a11y across 8 themes × 10 sections at 400ms settle** per §31's standing rule.

---

---

## 33. NCOPDS Drills + Demo Center Rebuilt on ROUTES (session 28)

### NCOPDS Drills (`#/drills`)
Six rehearsable versions of what BLC/ALC actually grade, built from the ISAP rubrics, TC 3-21.5 and ATP 7-22.02:

| Drill | What it does |
|---|---|
| Squad Drill sequence | 20 graded steps as recall trainer + full grouped sequence (−5/step) |
| PRT session builder | Both sessions block-by-block; leads with the **hard-copy DA 2977 + risk brief** as scored steps; all-or-nothing |
| Information brief | Live timer colour-coding the real 8:00–12:00 window + all 17 **1009S** rubric lines with point values |
| Essay word-count | Live count vs *actual* ranges (250–750 / 750–1250 / 2 pages) + five standards incl. "top 2%" and "80/20 analysis" |
| Conduct Individual Training | All 25 steps as checklist; −4 each, miss eight and you fail |
| MDMP step trainer | Seven steps, drilled on **what each produces** |

### Demo Center
**The tour was three sections out of date.** Hand-maintained 19-stop list never gained BLC, ALC or SLC — invisible in the very tour used to showcase the app. Now **derived from `ROUTES` (24 stops)**; closes a long-standing open item.

Added **per-stop "◉ Show them:" callouts** (the old tour said what a section *is*, never what to point at) and a **presenter cheat-sheet on the mode picker** — all 24 sections, tappable, since Free Mode drops to Home with no view of its own.

**Bug found in build:** first ROUTES-derived version produced an **empty** DEMO_STEPS and threw on every render — `ROUTES` is scoped inside the app-shell IIFE, invisible to the profile module where kiosk lives. The `typeof` guard failed *silently to empty* rather than loudly. Fixed by exposing **`G.routes`** as single source of truth; card renderer hardened against out-of-range index.

**Instrument errors 9 and 10:** case-sensitive check against a CSS-uppercased counter; `location.hash` set to the current page (no re-render, menu never returned); `innerText` missing content `textContent` found. All three confirmed against the DOM before touching code.

---

---

## 34. NCOPDS Glossary, Doctrine and Bibliography (session 29)

**Gap analysis first.** 67 candidate terms checked against the existing 3,592-term dictionary — **37 missing, 30 already present**. Only the missing were added. Dictionary now **3,629 terms**, advertised count updated to match rather than left stale.

**Acronyms:** ISAP · NCOLCoE · USANCOA · NCOA · RTI · SGL · ALA · NCO-C3 · DHG · DLG · SGM-A · EPS · DLC · PPW · PSL · STAB · OML · CES · PEBD · MBF · ASBS · ATIS · iPERMS · WHtR · 2MR · SPT · CIT · FD1 · MMD · RD · TR, plus assessment forms by number (1009A, 1009S, 1009W, DA 1059, DA 2977, DA 4856). Currency carried inline — SPT flagged as removed with the ACFT→AFT change; DLC as eliminated 1 Oct 2024.

**15 doctrine entries** under topic "NCO Development", sourced and searchable: NCOPDS ladder and pin-on gates · NCO-C3 · DA 1059 outcomes + the two-"Did Not Meet" rule · 1009A maths and the 480 threshold · honours and their point values + negative-counseling disqualifier · five writing standards · reassessment and dismissal · the information brief · PT and the DA 2977 · squad drill · MDMP · servant leadership/followership · be-know-do · ATRRS/IPPS-A/iPERMS/ATIS · DLC elimination.

**Bibliography** in the Drills module, grouped by purpose, each reference annotated with what it governs. Opens by telling the reader to go read the source.

**Standing rule refined \u2014 and new evidence not dismissed.** Two night-vision contrast violations reappeared at a **400ms** settle, past the 0.15s nav transition that explained them in §33. Rather than assume the known artefact, retested: **0 at 1500ms**, and 0 matrix-wide once a settle followed **each theme change**. A theme switch triggers colour transitions across the whole UI, so the settle must follow the theme change, not only navigation. §33's rule was right but incomplete.

---

---

## 35. Five-Phase Ship (session 30)

**Phase 1 — design-system hardening, done first deliberately.** 331 hex values audited: 283 inside theme/`html.light` token blocks (legitimate), print intentionally black-on-white, **46 genuinely loose → 16 converted → 7 remaining**. Every recent contrast bug traced to exactly this pattern.

**Phase 2 — Channels & Gates (`#/channels`).** Nine need→who→note rows, the PME/TIG/TIS gate table, five systems and what each decides, and **"if it is not in the system by the cut-off, it did not happen."** States plainly that a recruiter is not a promotion channel.

**Phase 3 — closed loops.** Board countdown on Home (required exposing `G.renderBoardCountdown`, same fix class as `G.routes`). **PPW now speaks to the board date**, scaling advice by proximity rather than producing a bare number.

**Phase 4 — polish.** Branding E1–E6 → **E1–E9** on the two branding strings *only*: the AAM card is correct doctrine and `rank: E1-E6` is a **functional IDP filter key** (7 occurrences) whose change would silently break goal targeting. **Backwards compatibility beat cosmetic consistency.** Added a **printable readiness summary** with signature blocks.

**Phase 5 — `GUIDON_DESIGN_SYSTEM.md`**, fourth canonical doc: 33 tokens with usage rules, 14 themes + light-class gotcha, 21 media conditions with consolidation recommendation, component inventory, five architecture constraints, verification standard with both timing rules, honest debt table.

**Verified:** 0 a11y across **14 themes × 12 sections**; console clean; existing profile loads with plan intact.

---

---

## 36. Backlog Cleared (session 31)

Of 24 open items: **6 completed, 3 blocked on missing source documents, 2 needing human judgment, 1 large architectural job**, rest standing rules or perishable reminders.

**Completed:** themed `G.modal` replacing native `prompt()`/`confirm()` (focus trap, Escape/Enter, `aria-modal`, danger variant; all three Account dialogs converted) · **Quiz study-level filter** (1,014 → 87 on Expert; defaults to All so existing behaviour is unchanged) · **nav re-tap re-renders** (previously a matching hash meant `route()` never fired and sub-views stuck open) · **guest session-only action plan** (4 items in cache, never written to IndexedDB, so "nothing is saved" stays true).

**Mistake worth recording:** the difficulty filter first landed in the **wrong renderer** — both Board Drill and Quiz declare `catSel`, and I matched the first. My `typeof diffSel !== "undefined"` guard made it fail *silently* — no error, no filter, no signal. **Second time a defensive `typeof` guard turned a real bug into a silent no-op** (first: the Demo Center's empty tour). Such guards hide the failures most worth seeing.

**Blocked, with reasons stated rather than quietly dropped:** AR 600-8-19 hit-count tables (have 2 anchors, interpolating; inventing rows would be worse) · civilian-ed per-credit rate (unverified; taken from the Soldier's PPW instead) · Combat Field Test (sources disagree 21 vs 24 MOSs) · the two card-review items (content judgment on someone's study material) · 5 MB lazy-load (deserves a dedicated session).

**Verified:** 0 a11y across 14 themes × 12 sections; console clean; no native dialog fires anywhere.

---

---

## 37. Design Handoff (session 32)

`GUIDON_DESIGN_HANDOFF.md` written as the **entry point for Claude Design**. Pairs with §35's `GUIDON_DESIGN_SYSTEM.md`: the handoff carries context, constraints and landmines; the system doc carries tokens and components. **Read the handoff first.**

**Handoff snapshot:** `guidon_76.html` · 4.83 MB · 24 routes · 32 modules · 171 KB CSS in 4 blocks · 33 tokens · 14 themes · ~918 classes · 44 media queries (21 distinct conditions) · 3 keyframes · 1,014 board cards · 3,629 acronyms · **0 WCAG 2 A/AA violations across 14 themes x 12 sections**.

**The handoff documents five landmines that each broke something real:** `--btn-ink` on accent fills (the most-violated rule; `.ob-avatar` sat at 2.55:1) · raw accents used as text (one orphaned rule caused 37 of 50 violations) · `--text-mute` being decorative only · light themes needing both `data-theme` and the `light` class · `nth-child` on nav surviving a DOM reorganisation · and defensive `typeof` guards across module boundaries failing *silently to empty*.

**Explicit do-not-change list:** print styles (deliberately black-on-white), theme/`html.light` token blocks, the `"rank": "E1-E6"` functional filter key, existing `prefers-reduced-motion` handling, IndexedDB schema.

**Priority order recommended:** consolidate 21 media conditions to a named scale → decide whether 14 themes earn their place → introduce purposeful motion → replace remaining native `<select>` styling → establish a typographic scale.

**The gap flagged hardest:** screen-reader and keyboard-only testing has never been done. Zero axe violations is real but is not the same as usable with assistive technology.

---

---

## 38. Keyboard & Screen-Reader Audit (session 33)

First keyboard/AT audit in the project's history — the gap §37 flagged hardest.

**Already right (do not "fix"):** one `main`, one `nav`, `lang="en"`, single `h1`, skip link hidden **off-screen** (`left:-999px`) rather than `display:none` (which would remove it from the tab order), `:focus-visible` styles present, two `aria-live="polite"` regions, **no heading-level skips anywhere**, focusable non-semantic element correctly carries `role="button"`.

**The real bug — the skip link was unreachable.** Tab on a fresh load landed on the first main-content button. Cause: the router focuses the view heading after every render (correct SPA practice for announcing navigation) **including the initial one**, dropping focus inside `<main>` before the first Tab and stranding everything before it in the DOM. **A skip link that cannot be tabbed to is decorative.**

**Fix:** `_firstRouteDone` flag suppresses the heading focus on first render only. Skip link is first stop on load; navigation still announces headings. Both halves verified. Added `role="banner"` to the topbar for complete landmark navigation.

**Method note worth keeping.** I nearly mis-diagnosed this twice — first a genuine test artefact (`offsetParent` null on `position:fixed`), then an assumption that the second failure was *also* an artefact. Only reloading **without** navigating reproduced the real bug. **Past instrument errors are not a licence to dismiss new evidence.** Also: an early grep flooded on the acronym dictionary again (3rd occurrence, after sessions 14 and 21) — anchored patterns only.

---

---

## 39. On-Device Self-Test Suite (session 34)

New section `#/selftest` under Account. Runs on the **actual device**, because that is where the untestable things live — TalkBack, S Pen hover, real airplane-mode offline, print, sunlight legibility.

**11 automated checks**, each reporting pass/fail + measured detail + *why it matters*: module integrity (12 `G.*`) · route health · **storage round-trip** (if this fails, grades silently stop saving) · content integrity (1,014 / 3,629 / 336) · **no external requests** (scans every href/src) · landmarks · **skip link genuinely first focusable** (caught a real bug in §38) · heading hierarchy · **contrast sample** (real luminance ratios on rendered text) · overflow · input mode (informational — CSS cannot detect S Pen hover). Verified 11/11, lowest contrast 4.63:1.

**9 manual checks with real protocols** — TalkBack (five specific confirmations in order), keyboard-only, S Pen hover *including that it must not fire on touch*, airplane mode with full restart, rotation, outdoor legibility, print, force-stop persistence, Demo Center dry run. Ticks persist to IndexedDB.

**Report export** — build, full UA, viewport/DPR, theme, every automated line, confirmed vs outstanding. Clipboard with printable-window fallback.

**States its own limits.** The suite ends by saying plainly it **cannot prove screen-reader usability** — it checks structure, which is necessary but not sufficient. TalkBack is first in the manual list for that reason. *A test suite that overstates its coverage is worse than none.*

---

---

## 40. Focus Theme Set (session 35)

Ten themes designed to **one brief**: promote focus, comfortable at any ambient brightness. Grouped as "Focus" in the picker.

**Principles applied uniformly:** never pure `#000` (halation, worse with astigmatism) or `#fff` (glare) · low chroma, **one** restrained accent each · small surface-to-surface steps so panels do not glare while text contrast stays high · `--glow-amber: none` · body text held at **12.7–14:1 (AAA)**.

**Solved numerically before writing CSS.** A script computed WCAG ratios and **iteratively tightened `--text-dim` until it cleared 4.5:1 against both `--bg` and `--panel`**. One accent came back at 4.36 and was darkened pre-ship. Contrast was designed in, not patched in after an audit complained.

| Band | Themes |
|---|---|
| Dim / night | Graphite Calm · Umber Lamp · Pine Dusk |
| Mid / indoor | Slate Quiet · Clay Warm · Harbor Mid |
| Bright / daylight | Parchment Read · Bone Neutral · Overcast · Sandstone Sun |

**Verified:** 0 a11y violations across 10 new themes × 10 sections; all appear in the picker; selection applies, persists, and sets `light` correctly on both dark and light members.

**Build trap worth remembering.** Injecting CSS at the last `</style>` landed it **inside a JavaScript string** — the print-summary code emits a literal `</style>`. A `<style>…</style>` regex hit the same trap. Fixed by mapping `<script>` spans first and choosing a `</style>` outside them. **In a single-file app, markup-shaped strings live inside the JS; naive tag searching finds them.**

**Count caution:** now 24 themes. §37's handoff names 14 as a liability. These ten were built to one coherent brief; the right follow-up is **retiring weaker originals**, not accumulating further.

---

---

## 41. Adaptability Audit — Six Real Viewports (session 36)

Measured against **real CSS viewports** (physical ÷ DPR, not guessed): Z Fold folded **344×882**, Z Fold unfolded **673×841** (nearly square, the awkward one), Tab S9 FE **720×1152** / **1152×720**, phones 360×780 and 320×700.

**Quiz cards were already fine — verified, not assumed.** Scale cleanly 284×322 → 888×480, holding 42–52% of viewport height throughout. Flipped to the **longest card in the corpus** (`ucmj-2`, 1,911 chars): **no clipping at any viewport**, `.qz-back-scroll` correctly scrollable. Checked before changing anything; nothing needed changing.

**Two real bugs in the wider sweep:**

| Bug | Detail |
|---|---|
| `.segmented { overflow:hidden }` | Trailing tabs **unreachable** at 344px — 570px strip in a 306px box. Fixed: `overflow-x:auto` + `max-width:100%` + scroll-snap, hidden scrollbar. Scroll not wrap — wrapping destroys the pill shape. |
| Channels gate table | 5 columns exceeded viewport at 320px (**my own bug from §35**). Below 420px rows stack with `data-label` prefixes. |

**Result: 0 layout issues across 6 viewports × 16 sections** (from 5). Sweep checks three things independently: page overflow, any element wider than viewport, and horizontally clipped text lacking a scroll affordance.

Verified 0 a11y at Z Fold unfolded across 4 themes × 4 sections including two Focus themes.

---

---

## 42. Hosted Access & Share Panel (session 37)

**Hosting works — verified from a real `https://` origin** under iPhone 15 Pro (Safari UA), Pixel 8 (Chrome UA) and iPad. All three: IndexedDB read/write OK, board renders, manifest present, **zero external requests**, zero overflow, console clean.

**Transfer size measured:** 4.89 MB raw → **1.47 MB gzipped (31%)**.

**New section `#/share`:** the app's own URL with copy button (paste into any QR generator) · **the iOS seven-day storage-eviction warning** with exact Add-to-Home-Screen steps, stated as a *before you start* action because Safari drops IndexedDB after ~7 days without a visit · Android steps · and "what hosting does and does not change", including plainly that **the server can see who fetched it**.

**A QR encoder was written and removed.** Full Reed-Solomon over GF(256), byte mode, v1–10, implemented in-app since no CDN is allowed. Verified by **decoding its own output with OpenCV** — it failed all four test strings. **Removed rather than shipped**: an unscannable QR failing in front of a formation is worse than none. The module retains a comment on what was tried and why it is gone.

Same discipline as the promotion-points work: interpolated weapon table labelled an estimate, civilian-ed rate taken from the Soldier's PPW rather than guessed, QR encoder that could not be proven correct does not ship.

---

---

## 43. Project Map — Document Index, Feature Summary, Wiring Diagrams (session 38)

`GUIDON_PROJECT_MAP.md` — a single orientation document, meant to be read **before** this masterfile. Live facts pulled directly from `guidon_86.html` rather than carried forward from memory: **26 routes / 5 nav groups / 34 JS modules / 24 themes / 33 CSS tokens / 1,014 board cards / 3,629 acronyms / 290 doctrine entries.**

Contains: a table of every canonical document and when to read it · the feature set grouped by nav group · an ASCII module-wiring diagram showing the `window.G` shared surface and which modules expose what · a profile/board-date data-flow diagram showing how one date drives the countdown, the action plan, and the PPW advice · a storage-split diagram (IndexedDB vs sessionStorage vs in-memory-only, and why Guest mode's plan is deliberately never written to disk) · a theme-system diagram · and a distilled list of the six standing rules this project has actually needed, each traced to a real bug that taught it.

No app code changed. `guidon_86.html` remains the build.

---

---

## 44. Packaging — Installable PWA, Windows Desktop App, Android APK (session 39)

**Ask:** make this a top-notch mobile app and PC application.

**The build was not where the documents said it was.** `guidon_86.html` exists nowhere on disk; the current build is `guidon_index.html` (5,133,364 bytes, three byte-identical copies). `GUIDON_DEPLOY.md`, listed as canonical in the project map, had never been written. And the live app has **29 routes, not 26** — the map's figures were already stale. New project root: `guidon-app/`, version **1.2.0**.

### The finding that reframed the whole session

The app was not one step from being installable. It was structurally prevented from it, in three independent ways:

| | |
|---|---|
| `registerSW()` began `if (window.GUIDON_SINGLEFILE) return;` — and that flag is **always true** | The service worker could never register, in any deployment. A hosted copy had **no offline capability whatsoever**. Open item #1 was not "not added yet"; it was short-circuited. |
| The manifest was a `data:` URI | Chromium does not install from one. The Add-to-Home-Screen guidance in §42 was pointing at a door that could not open on Android. |
| No `apple-touch-icon`, and `storage.persist()` never called | iOS used a screenshot as the icon — and the ~7-day IndexedDB eviction §42 documents so carefully was only ever **warned about**, never mitigated. `navigator.storage.persist()` is the API that mitigates it. |

**Baseline measured before touching anything: 10 pass / 3 fail — and all three failures were packaging.** The app itself was already excellent: 29 sections × 6 real viewports, zero overflow, zero console output, zero external requests. Sessions 5–38 hold up completely under an independent harness.

### One source, two promises

`src/index.html` now builds to **two** artifacts, because the project has two distribution promises and they conflict:

- **`dist/guidon-standalone.html`** (4.90 MB) — the hand-someone-the-file build. A real manifest would make it log a 404 for a sibling that isn't there, so it keeps the inline `data:` manifest and every asset embedded. Verified from an actual `file://` origin: 29 routes, DA 4856 export works, IndexedDB persists, **zero external requests**.
- **`web/`** — the installable bundle: real manifest, service worker, PNG + separately-declared maskable icons, `apple-touch-icon`.

Every build edit is an asserted replacement that **fails loudly if its anchor is not found exactly once**. This caught §40's trap immediately: `</body>` is not unique in this file — the print-summary code emits a literal `</body></html>` inside a JS string. The anchor is the document terminator instead.

### Measured before cut, not assumed

`tools/perf.mjs` builds throwaway variants with one payload surgically removed and compares cold boots under CPU throttling:

| At 6× throttle (budget phone) | DomContentLoaded |
|---|---|
| Full build | 744 ms |
| Deferring the PDF stack | **−113 ms** |
| Deferring `GUIDON_SEED` | **−329 ms** |

**First Contentful Paint is unchanged in every variant** (~130–180 ms). The app already paints before the heavy scripts parse — the cost was always time-to-interactive, never time-to-pixels. That reframing is worth keeping.

**Done:** pdf-lib (525 KB) plus both embedded DA 4856 forms (371 KB) extracted to `web/assets/`, loaded only when a form is actually exported. Safe because `G.pdf456` already read both globals lazily inside functions. Still precached, so **offline export was verified by generating a PDF with the network cut**.

**Not done, deliberately:** the 3.26 MB seed. Bigger win, but every module reads it, it has been flagged for its own dedicated session repeatedly, and it is not worth risking a study app's correctness on a change that cannot be fully re-validated in one pass. The number is now recorded so the choice is informed rather than merely deferred again.

### Windows desktop — Tauri, not Electron

**2.34 MB installer, 27 MB resident.** Electron would have been ~150 MB. Rust was already installed and MSVC links cleanly.

Verified beyond "it compiled": the process holds the right window title with 35 threads, and WebView2 created `IndexedDB/http_tauri.localhost_0.indexeddb.leveldb` containing database `guidon` with stores `kv` / `meta` / `userScenarios` / `attempts` and real writes (`legacyStorageMigration:v1`, `streak:v1`, dated today). **That is runtime proof the app booted and ran its data layer, not a blank window.** The bundle was separately run under the exact CSP from `tauri.conf.json` — 29 routes render, deferred PDF loads and generates, blob downloads work, zero violations.

### Android — Capacitor

The Android SDK and a bundled JDK 21 turned out to be **already installed**, so no multi-GB install was needed. APK: **5.67 MB**, `app.guidon.trainer`, minSdk 24, targetSdk 36, all assets embedded, 17 launcher icon entries. Fully offline — no hosting required.

**Run on a real Android runtime, not just built.** An Android 14 emulator was created and the APK installed and launched on it. Playwright's `connectOverCDP` cannot attach to Android WebView (it needs browser-level endpoints WebView does not implement), so `tools/cdp.mjs` speaks raw DevTools Protocol to the page target instead. Against WebView **Chrome 113** — deliberately older than the Tab S9 FE would run:

- 29 routes registered · zero overflow across all of them at 1280 px · zero console output
- `data-display-mode="native"` — so the installed-app affordances engage
- **No service worker registers**, which was an open question rather than a certainty. `window.Capacitor` is present before `pwa.js` runs, so native detection wins. Confirmed by evidence, not by reasoning about injection timing.
- pdf-lib still deferred at boot, and **the DA 4856 exported from APK assets — a real 43,914-byte PDF**
- IndexedDB read/write works, so study progress persists

**No release keystore was generated.** A keystore is a credential, and losing it means never being able to update the app on Play Store again. That is the owner's to create.

### Two instrument errors, both mine, both caught before touching code

The standing rule earned its place twice more:

1. A test failed on `DA4856 asset short/missing: 56748`. The **threshold was wrong**, not the code — the file carries *two* forms (`DA4856_B64` at 56,748 chars and `DA4856_MAR2023_B64` at 314,152).
2. Gradle died with a bare `java.io.IOException: Invalid file path` naming no path. Not spaces in the path, not the drive. Java `.properties` files treat backslash as an escape, so `sdk.dir=C\:\Users\…` silently parses as `C:UsersOblivAppData…`. **Forward slashes.** It looks like a Gradle bug and is not one.

A third near-miss: the pdf-lib `Removing XFA form data…` warning looked like a regression from deferral. Generating a PDF from the **untouched original build** produced the identical message. Pre-existing, now allow-listed *with the reason recorded* rather than silently filtered.

### Verification

Four Playwright suites against a real HTTP origin, all following this project's standing rules — `warning` captured as well as `error`, section list derived from `G.routes`, settle longer than the longest transition.

**27/27 verify · PDF suite passed · standalone suite passed · CSP suite passed.** The headline: **the app now reloads and boots with the network disabled**, asserted by actually cutting the network rather than by checking that a worker object exists.

### Open

- **The emulator is not the Tab S9 FE.** Verified on Android 14 / WebView 113 at 1280 px; still worth a sideload on the real tablet, where S Pen hover (§17) and the 90 Hz panel exist and an emulator has neither.
- Emulator rotation to portrait did not take effect, so the Android portrait sweep is untested on-device. The 720×1152 portrait case is covered in the browser harness.
- iOS cannot be compiled on Windows. The home-screen path is genuinely good now; a native build needs a Mac and a $99/yr account.
- `GUIDON_PROJECT_MAP.md` still says 26 routes and lists `guidon_86.html`. Both are stale.

**A fourth instrument artifact, worth recording:** a test navigated to `#C:/Program%20Files/Git/board` because Git Bash rewrote the argument `"#/board"` into a Windows path before Node saw it. MSYS argument mangling — set the hash inside the evaluated JS rather than passing it through a shell. The app handled the garbage hash without crashing, which is its own small good news.

---

## 45. PC and Android, taken to native quality (session 39, part 2)

**Ask:** focus on PC and Android; Apple goes on the backburner.

### The Back button did nothing, and only a device could show it

The single most important finding of this phase. §44 had recorded a *deliberate* decision not to override Capacitor's Back handling, reasoning that its default — pop WebView history, exit at root — is already correct for a hash router. **That reasoning was wrong, and testing on a device proved it.**

Measured: Android's Back delivered `{canGoBack:false}` to the web layer **with `history.length` at 33**, and Capacitor performed no default action. Back navigated nothing and exited nothing. On Android that reads as a broken app.

The cause is that `canGoBack` reflects WebView *document* navigation, and GUIDON is a hash router — it is simply the wrong signal. `src/native.js` now tracks its own depth and implements the real Android contract: **close an open dialog → `history.back()` while depth > 0 → `exitApp()`**. Dialogs are closed by dispatching Escape, reusing `G.modal`'s own tested close path rather than reaching into its internals.

One subtlety worth keeping: the router assigns an initial hash at boot. Counting that as a step would make the first Back land on a hash-less URL that `start()` immediately re-routes — a Back button that never exits. Depth baselines after boot instead.

Verified on-device and automated as `npm run test:android:back`: `#/progress → #/board → #/home → app exits, launcher regains focus`.

> The lesson generalises: §44 reasoned its way to a conclusion about platform behaviour and recorded it as settled. **Reasoning about a platform is not evidence about a platform.**

### The rest of the Android shell

- **System bars follow the active theme.** 24 themes, 5 light — a fixed bar colour is wrong for at least 19 of them, and a light theme under a dark bar is an instant tell. The colour is read from the app's own `--bg` token and icon contrast is computed from that colour's WCAG relative luminance rather than hand-mapped per theme. Verified switching light↔dark on-device: `#e8dfc9 ⇄ #0a0e12`.
- **Branded splash** at all 11 densities plus the Android 12+ SplashScreen API. The adaptive-icon background was `#fff`, which showed white behind the mark once a launcher applied its mask — now brand dark.
- **Signed release build.** APK 4.47 MB (smaller than the 7.26 MB debug), AAB 4.34 MB, certificate fingerprint matching the keystore. R8/minify left off deliberately: there is almost no app Java to shrink and it is a known source of release-only breakage in WebView shells.
- **Phone form factor verified** — a second AVD at 1080×2400/420dpi gives a real **412×842 portrait** viewport. 29 sections, zero overflow. The tablet AVD could not be rotated, so this closed a genuine gap rather than a theoretical one.

### Windows

- **Remembers its window** (size, position, maximised) and **single instance** — relaunching raises the open window instead of starting a second copy fighting over the same IndexedDB. Both verified via Win32 `GetWindowRect`/`MoveWindow`: moved to `200,140 1100×760`, closed, relaunched, **restored exactly**.
- **The window-state plugin saves on graceful close, not on kill.** A `Stop-Process -Force` produced no state file and briefly looked like a plugin failure. It is not — closing via `WM_CLOSE` writes it correctly. Worth knowing before diagnosing.
- **The installer is now actually tested**, which §44 listed as an open item: silent install → per-user `%LOCALAPPDATA%\GUIDON` → Start-menu shortcut → correct Add/Remove entry → launches (27 MB resident) → silent uninstall leaves **nothing** behind. Publisher read `guidon` from the crate name; set explicitly to `GUIDON`.

### Open

- **Windows code signing is not done.** SmartScreen will warn on first run of an unsigned installer — expected, not a defect. Needs an Authenticode certificate (~$200–400/yr) before wide distribution; not worth it to hand an installer to a squad.
- **The tab strip clips on a 412 px phone** with no visual affordance that more tabs exist. §41 deliberately chose scroll-not-wrap to preserve the pill shape, and that decision stands — but a scroll hint is a real improvement. Not made here: `.segmented` is shared across 24 themes and late-session shared-CSS changes are exactly what this project's history warns about.
- The release APK could not be driven over CDP (release builds disable WebView debugging), so it was verified by install and launch rather than by scripted assertions.

### Two more instrument errors — running total now seven this session

5. **A fixed 900 ms wait** in the theme test raced with app initialisation re-asserting the stored theme, reporting a working feature as broken. Fixed by asserting the real invariant — *bar colour equals current `--bg`* — and polling for it.
6. **`| tail -N` on a background build masked both the real error and the exit code.** Gradle's `BUILD FAILED` was reported as exit 0 twice before I stopped piping build output through `tail`.

And one genuine bug of mine: `file()` in `app/build.gradle` resolves from the **app module**, not the project root, so `../keys/` looked in `android/keys/`. `rootProject.file()` is correct.

Full build, host and packaging instructions: **`GUIDON_DEPLOY.md`** — written this session, the file the project map has referenced all along.

---

## 46. Currency Pass + Records Readiness + Points Gap Analyzer (session 40)

**Ask:** implement Tier 1 (policy currency) plus Records Readiness and a points gap analyzer, auditing and hardening between tiers.

### The regulation was obtained, not summarised

Search snippets were not treated as sufficient for content a Soldier plans a career on. `armypubs.army.mil` content search resolved **AR 600-8-19, 6 March 2026, effective 6 April 2026** (ARN43646) — note the title is now *Enlisted Promotions and **Demotions***, and it supersedes the 21 June 2024 edition. The 121-page PDF was pulled and parsed locally.

That produced two corrections to what search alone had reported: the regulation both **removes the requirement** to laterally appoint SPC→CPL *and* **establishes policy** for it (search said only the latter), and it eliminates the **HQDA bar** for missing SSD/DLC rather than "all references to DLC".

### Two long-standing open items closed with real data

| Was | Now |
|---|---|
| Weapons points **interpolated** between two published anchors, labelled an estimate (§27) | The real **tables 3-2 and 3-3**, transcribed. The anchors were right — but the curve between them is not linear, so every interpolated middle row was wrong. |
| AFT entered as **pre-converted points**, because the conversion was not published in-app | The real **table 3-4**. The old hint said "a 500 is worth 80" — it is **120**. |

Three weapon scorecards are now selectable, because 30 hits maxes a DA 7814 pistol card but is mid-table on a rifle; scoring everyone on the rifle table badly misreported pistol-primary Soldiers.

`tools/test-points.mjs` asserts **all 90 published weapons rows, all 41 AFT bands (123 probes), edge cases, and every category maximum** against the regulation. Hand-transcribed regulation data is exactly what rots silently, so it ships with the real rows in a test.

### #6 — gap analyzer

The previous coaching ranked categories by **remaining headroom**, which is misleading: the category with the most room is often the hardest to move. It now produces **quantified, ranked actions** computed from the real tables — *"+37 pts · requalify at 40/40"*, *"+8 pts · 40 hours of ATRRS correspondence"* — and accepts a **cutoff the Soldier enters themselves**. No cutoff scores are shipped; they move monthly, and that refusal is unchanged.

### #5 — Records Readiness (`#/records`)

23 checks across iPERMS, IPPS-A, ATRRS/DTMS, the clock, and the board file, persisted to IndexedDB. Built on the research finding that Soldiers lose points to **records**, not doctrine — and on AR 600-8-19 para 3-14, which states plainly that corrections made after a cutoff move the *following* month's score, not this one.

### Tier 1 — `#/fitness`

The largest content gap: the **Combat Field Test** had **zero** mentions. Seven events, 24 MOSs, 30-minute cap, ACU and boots, pass/fail, age- and sex-neutral, Army Directive 2026-07 — diagnostic from April 2026, for record after ~April 2027 with Flag code C. Plus the **AFT combat standard** (21 MOSs, 350, AEA `AECBTDQ` blocking PCS, reclassification path), which was also absent — the four "combat standard" hits in the corpus were Warrior Ethos cards.

**This resolved the "21 or 24 MOSs?" open item.** The sources were never in conflict: AFT combat standard = 21; CFT = those 21 **plus 12D, 89D, 89E** = 24. Two tests, two lists.

Also corrected: Continuation Pay (window opens at **7 years** from 1 Jan 2026, was "8-12" in two places), and a Channels panel covering lateral appointment, secondary-zone waiver removal, the DLC bar, and Credentialing Assistance (**$2,000/FY**, commander approval via ArmyIgnitED).

### The ACFT sweep: audited, and deliberately not done

221 references; 46 already contextually flagged as historical, **175 not**. A regex cannot reliably separate *"the ACFT is the test of record"* (now wrong) from *"the ACFT was replaced"* (fine), which is precisely why §28 refused a bulk replace. **Measured and reported rather than rushed.** `#/fitness` is now the authoritative home for current standards, which reduces but does not remove the risk.

### Architecture: `src/app-modules/`

New app content lives in `src/app-modules/*.js` and is injected into **both** artifacts (unlike `pwa.js`/`native.js`, which are packaging and web-only). Safe because `ROUTES` render callbacks are lazy arrows and the shell defers `app.start()` to `DOMContentLoaded`.

### Three self-inflicted faults, caught by the suite

1. **Python `open(...,'w')` on Windows rewrote the entire 5 MB file to CRLF**, breaking the build's document-terminator anchor. Always `newline=''`.
2. Anchors assumed unique were not: `mount.appendChild(links)` appears in **four** modules; the continuation-pay sentence appears **twice**. The build's assert-exactly-once rule caught both.
3. **Three test files each hard-coded "29 routes"** and went red when two sections were added — the same hand-maintained-parallel-list mistake §33 hit in the app, this time in the tests. Now derived via `tools/declared-routes.mjs`.

**Verified:** 27/27 · points · PDF · standalone `file://` · desktop CSP — all passing across **31 sections** and 6 viewports, zero console output.

---

## 47. Career Calendar, Enlisted Marketplace, Squad Roster (session 41)

**Ask:** proceed with the next tier — the career-operating-system items and the leader multiplier.

**Labelling correction first:** these were Tier 3 (#7 calendar, #8 Marketplace, #9 credentialing) and Tier 4 (#10 leader mode) in §46's own numbering. §46 wrongly called them "Tier 2's remaining items" — Tier 2 was #5/#6 and shipped in §46. Recorded so the numbering in the recommendations doesn't drift further.

### `#/calendar` — the dated spine

Every other section answers *what is true*. This answers *what is about to expire* — a different failure mode. A Soldier who knows doctrine cold still loses up to 160 promotion points when their weapons qualification quietly passes **24 months**, because AR 600-8-19 para 3-15a(2) awards nothing beyond that.

Seven tracked dates, each stating its **consequence** rather than just a reminder, sorted by urgency (red ≤14 days, amber ≤45). Plus two fixed anchors nobody sets and everybody forgets: the **26th-of-month** promotion cut-off, and the **1 October** Credentialing Assistance fiscal-year reset ($2,000, does not roll over). Board date and ETS are read from the profile rather than asked for twice.

Deliberately built on dates the Soldier enters. There is no network and there is not going to be one, so the honest design is to make the arithmetic and the consequence obvious, not to pretend we know when their last AFT was. The footer says plainly that if a date here disagrees with the system of record, the system of record wins and they have a records problem.

`tools/test-calendar.mjs` asserts the arithmetic: 25 months since qualification reads **OVERDUE**, one month reads **701 days out**, an 11-month-old AFT lands inside the amber window, rows sort soonest-first, and entries survive a reload.

### `#/assignments` — Enlisted Marketplace

Previously zero coverage, which is a strange gap: for most Soldiers the next duty station shapes the next three years more than any single promotion point.

**The honesty problem this module had to solve first:** the Marketplace is principally **SSG through MSG**. A Specialist reading a generic "here is how you pick your assignment" page would be actively misled — their lever is *reenlistment options*, not preferencing. So the module opens with who it applies to instead of burying it.

Covers **YMAV** (what makes you a mover) and **YMAEAT** (the primary factor under formal stabilisation), the four annual cycles, the factors HRC weighs (time on station, **KDA** completion, unit strengths, CMF Talent Development Plan), and the preferencing mechanic that actually matters: anything left unpreferenced is treated as **equally desirable** and ranked between top-down and bottom-up choices — so silence is a choice, and a bad one. Cycle dates are **not** shipped; there are four a year and they move.

### `#/leader` — Squad Roster, and the privacy problem it created

The app is named for leader development and, until now, served exactly one person: whoever held the phone. This tracks the duty leaders are most often gigged on and least often reminded about — **monthly developmental counselling** — plus AFT, weapons qual and NCOER dates per Soldier, surfacing who is overdue and by how much.

**This is the first feature in GUIDON that stores data about other people, on a device belonging to one of them.** That drove the design: dates only, no performance narrative and nothing medical/legal/SHARP/financial, initials rather than names, one obvious Clear button, and double-confirmed removal.

**And it created a real regression I caught by auditing rather than by testing the feature.** `G.backup.exportAll()` dumped the entire `kv` store — its comment literally read *"Skip nothing here"*, which was correct when everything in `kv` was the user's own data and stopped being correct the moment a roster existed. Backup files are downloadable and emailable, so a leader could have sent other Soldiers' tracking data without knowing.

Fixed with a `PRIVATE_PREFIXES` exclusion: the roster is **left out by default**, `includePrivate: true` is a deliberate opt-in, and the payload carries `excludedPrivateEntries` and `includesOtherPeoplesData` so an importer can tell. The consequence — the roster does not follow you to a new device — is stated in the module rather than discovered.

`tools/test-privacy.mjs` asserts the roster is absent from a default export, that the user's own data still is not, that the initials appear **nowhere** in the payload string, and that opt-in works and is flagged.

### State

**34 sections** (was 31). Nine suites: verify · points · calendar · leader · privacy · PDF · standalone `file://` · desktop CSP — all passing, zero console output across 6 viewports.

**Not done from this tier:** #9, the per-MOS credentialing pathway. The CMF-level mapping already in the MOS Career Center remains the coverage, and the CA rules landed in §46's Channels panel. Going per-MOS needs Army COOL data the app does not have and should not invent.

---

## 48. The ACFT Audit That Two Sessions Declined, and a Currency Surface (session 42)

**Ask:** finish the remaining recommendations — freshness surfacing (#11) and the 175 unaudited ACFT references.

### The audit two sessions refused to do — and what it found

§28 declined a bulk ACFT sweep: *"Bulk replace across a 7,245-mention corpus without reading context would inject more errors than it removed."* §46 re-measured (221 refs, 46 flagged historical, 175 not), reached the same conclusion, and stopped.

**Both were right about the method and wrong about the conclusion.** A regex over raw text genuinely cannot classify these. But walking the **parsed seed object** and classifying by *claim shape* found the real errors in a single pass — and they were not cosmetic naming drift. They were **self-contradictions on live policy**:

| Found | Why it mattered |
|---|---|
| **Three** cards answering that a 465+ AFT grants a taping exemption | While another card correctly explained that AD 2026-13 **rescinded exactly that** on 7 July 2026. The app gave opposite answers to the same question. |
| Six cards teaching **six events** including the Standing Power Throw and Leg Tuck | Both removed. One of them, `acft-events`, is the card §28 recorded as *fixed* — its `.a` was corrected and its `.boardAnswer` was not. **A card contradicting itself.** |
| **360** as the current minimum, in five places | That is the six-event maths. The AFT is 5 × 60 = **300**, or 350 combat. |
| A scenario built on *"302, two points below the 360 minimum"* | Under the AFT, **302 is a pass.** The premise was impossible. |
| A **counselling bullet template** targeting "a passing ACFT score of 360 or higher" | A leader would paste that straight into a live DA 4856. |

Also corrected: two acronym definitions (the Plank as "alternative to the Leg Tuck"), three curriculum lessons, and a resilience training-guidance body still programming for the SPT.

### `tools/test-consistency.mjs` — so it cannot come back

Eight assertions over the parsed seed. Four negative (no live 465 exemption claim, no six-event teaching, no 360 minimum, no SPT/Leg Tuck as current) and four positive (the 300 and 350 standards, AD 2026-13, and the five-event description must all be **present**).

The rule it encodes: **a statement of the current standard must be current; historical framing is fine and stays allowed.** That distinction is the whole reason a naive replace would have been vandalism.

**The test was wrong three times before the content was.** It flagged `Single-Leg Tuck` (an FM 7-22 hip-stability drill), then `Leg Tuck` in the FM 7-22 **Climbing Drill** — both current, correct, and nothing to do with the removed event — and then my own corrected text saying the SPT *"was removed"*. Each correction went into the checker, not the corpus. Verify the verifier, three more times.

### `#/currency` — #11, freshness surfacing

The app stored `asOf` stamps and never showed them. That is the wrong way round: a reader cannot tell a fact verified last week from one carried a year, and the ones most likely to be stale carry career consequences.

Eight policy areas, each with the edition it is built on, what in the app depends on it, and **who to ask**. Age is **computed from the stamp at render time**, so the page gets more honest as the build ages rather than less. Bands are set by measured volatility, not importance — the acronym dictionary's 2021 DoD baseline is the oldest thing in the app and says so.

It deliberately does **not** phone home. There is no feed, and faking one would be worse than the staleness it exists to surface.

### State

**35 sections.** Nine suites: verify · points · consistency · calendar · leader · privacy · PDF · standalone `file://` · desktop CSP — all passing, zero console output.

### The lesson worth keeping

Two sessions logged this as "needs a contextual pass" and moved on, because the *tool* they reached for was wrong. **Deferring on method grounds quietly became deferring on substance** — and for eight months the app answered a live policy question two different ways depending on which card came up. When the method is the blocker, change the method.

---

## 49. The Seed Optimisation Everyone Deferred, and a Tab-Strip Affordance (session 43)

**Ask:** continue from where the last session stopped.

### The seed, finally — by changing the lever rather than the schedule

Deferring the seed work is the oldest recurring item in this project. Every session reached the same conclusion for the same reason: the obvious lever is **making the seed load asynchronously**, that touches all 34 modules reading `store.*`, and risking a study app's correctness for ~200 ms is a bad trade. Correct — and it meant nothing ever happened.

**There was a second lever nobody had tested.** V8 parses JSON with a dedicated parser that is materially faster than the full JavaScript parser over identical bytes. The seed is already strict JSON in an object-literal position, so `{...}` → `JSON.parse("...")` is a **build-time transform with no async, no module changes, and no architectural risk at all.**

Measured (`npm run perf:seed`, median of 5 cold loads at 412×915):

| CPU throttle | literal | JSON.parse | saving |
|---|---|---|---|
| 1× | 85 ms | 81 ms | −4 ms |
| 4× (mid-range) | 395 ms | 362 ms | −33 ms |
| **6× (budget)** | **652 ms** | **558 ms** | **−94 ms (14%)** |

Cost: +0.11 MB raw, and **measured zero gzip and zero brotli** — the escaped quotes compress away completely, so nothing extra crosses the wire. Applied to **both** builds.

That is 29% of the theoretical maximum (§46 measured 329 ms for removing the seed entirely) for none of the risk. The build asserts the literal is strict JSON and **fails loudly** if it ever stops being — a trailing comma, a comment, an unquoted key.

**The measurement lied first, and said what I wanted to hear.** The initial run reported JSON.parse **37% faster** — because my hand-rolled string escaping was wrong and the variant had silently stopped booting. The harness carried a `booted` flag alongside every timing, which is the only reason it was caught; the numbers alone looked like a triumph. Fixed by letting `JSON.stringify` build the literal instead of escaping by hand. **A performance result without a correctness check beside it is not a result.**

Seed integrity is now asserted in `test-consistency.mjs`: 17 top-level sections, 1,014 board cards, 3,629 acronyms, 336 doctrine entries, 163 MOS, 182 scenarios. A truncated seed would still boot, so booting is not the test.

### `#/…` tab strips now say they scroll

§41 made `.segmented` scroll rather than wrap, which fixed *reachability* — the trailing tabs stopped being unreachable — and left a real hole: at 412 px the Board Prep strip reads `… POINTS | RE…` with nothing indicating it moves. §45 flagged it and deliberately deferred it as late-session shared-CSS risk. That caution no longer applied.

The affordance is a **mask**, not a coloured gradient. With 24 themes any colour would be wrong in most of them, and the buttons paint their own backgrounds so a background gradient would sit behind them invisibly. A mask works on alpha, so it fades whatever is actually there and is correct in every theme for free.

`js/scrollhint.js` sets `data-scroll` from **measured geometry** — whether a strip overflows depends on how many tabs that view has, not on screen width — and scrolls the active tab into view on render. `prefers-contrast: more` and the in-app high-contrast toggle both disable the fade, because dimming an edge is the opposite of what someone asking for more contrast wants.

Verified: hint present at 412 px, flips side when scrolled to the end, **absent at 1440 px** where the strip fits, and suppressed under high contrast.

### State

**35 sections. Ten suites** — verify · points · consistency · calendar · leader · privacy · scrollhint · PDF · standalone `file://` · desktop CSP — all passing.

### The lesson

An item deferred for the same stated reason across many sessions is not usually blocked by effort. It is blocked by the **approach everyone keeps assuming is the only one**. The seed was never the problem; the async refactor was. When something has been deferred more than twice, the useful question is not "do we have time now" but "is there a different lever".

---

## 50. The Screen-Reader Gap, Narrowed (session 44)

**Ask:** continue onward.

### The gap §37 flagged hardest, and §38 could not close

§37 named screen-reader usability the project's biggest unknown. §38 did the keyboard and structure work and said plainly that it *"cannot prove screen-reader usability — it checks structure, which is necessary but not sufficient."* That has stood open ever since, because the obvious way to close it is to run NVDA or JAWS, and neither is installed here (Narrator is, but cannot be driven headlessly to capture speech).

**There was a more rigorous option nobody had reached for.** axe-core checks *rules against the DOM*. A screen reader consumes the **computed accessibility tree**, which is a different artefact — and CDP will hand it over. `tools/test-a11y-tree.mjs` reads that tree across all 35 sections and checks what AT actually receives.

The defect class this exists to catch, which axe-core structurally cannot: **controls that are perfectly labelled in isolation and useless in an elements list.** AT users navigate by pulling up a list of every control on the page, stripped of surrounding context. Eight buttons all announcing "Open section" pass every rule and are unusable there.

It found exactly that, and most of it was mine:

| Finding | Origin |
|---|---|
| **8× "Open section"** on `#/currency` | §48, mine |
| **18× "Load into grader"** on `#/write` | pre-existing |
| **2× "Compact"** in Settings — text size and side-rail density | pre-existing |

Fixed by naming controls for their destination (`Open Fitness`, `Open Board Prep`), and by adding an optional `groupName` to the shared `optGrid` helper so option sets carry a group label. In every case the visible text remains a **prefix** of the accessible name, so WCAG 2.5.3 (label in name) still holds — a fix that breaks speech input to help screen readers is not a fix.

### The checker was wrong three times before the app was

A pattern this project has now recorded so often it should be assumed:

1. **Every heading level read as `NaN`**, reporting "0 level-1 headings" on 24 sections. CDP wraps every property in an `AXValue` — `.value` returns the wrapper, not the number. The outline was correct all along.
2. **`<input type="date">` was never name-checked at all.** Chromium exposes it under role `Date`, which was missing from the interactive set — so the audit skipped the seven real date fields and flagged Chromium's internal `Month Month` / `Day Day` spin buttons instead.
3. Those internals were then reported as duplicate names. They are browser-generated, identical in every date field by construction, and cannot be renamed by any app. Excluded, with the reason recorded.

**Verify the verifier — three more times.** The date-field labels turned out to be correct and distinct the whole time.

### Alongside

- **`GUIDON_APP_VERSION` said 1.1.0** while every installer said 1.2.0. The About panel was contradicting the thing it shipped inside. Now aligned, with the build date.
- **`GUIDON_PROJECT_MAP.md` refreshed from live figures.** It claimed 26 routes (35), 290 doctrine entries (336), ~918 CSS classes (~1,048), and a build file that no longer exists. Every number in it is now pulled from the built app, and the correction is recorded in the document itself.

### State

**35 sections. Eleven suites** — verify · points · consistency · calendar · leader · privacy · scrollhint · **a11y-tree** · PDF · standalone `file://` · desktop CSP — all passing, zero warnings.

### What this does not claim

It is **not** a substitute for a real screen reader driven by a real user. It reads the data AT is handed and asserts that data is usable; it cannot tell you whether the experience *is*. That distinction is the whole reason §38 refused to claim more, and it still stands. What changed is that the gap is now narrower and measured, rather than open and unmeasured.

---

## 51. NVDA, and the Bug That Only a Screen Reader Could Find (session 45)

**Ask:** install NVDA and walk three flows — onboarding, a Board Drill card, a DA 4856 export.

### The finding

**`#route` — the entire main view container — carried `aria-live="polite"`.**

Every navigation therefore pushed the whole rendered section into a polite live region, and NVDA read **the complete page aloud**. On Doctrine, or the 3,629-term dictionary, that is thousands of words of unstoppable speech on every single route change. The app was effectively unusable with a screen reader, and had been for its entire history.

The captured transcript before the fix is one continuous announcement running *"BOARD PREP BOARD DATE Month Set your board date /Day … Tap a card (or press Space) to flip it. Grade yourself 1-4 …"* through the entire view. After removing the attribute, the same keystrokes produce discrete, navigable output: `main landmark` → `Quick navigation | grouping` → `button | ▶ TRAIN` → `heading | level 2 | TRAIN THE DECISION…`.

**Nothing caught it, and three separate things should have:**

| | |
|---|---|
| axe-core | `aria-live` on a container is valid markup. Zero violations, correctly. |
| §38's keyboard/structure audit | Checked focus order and landmarks. A live region is neither. |
| §50's accessibility-tree audit | Counted the region's **existence** as a PASS — *"2 live regions present"*. It endorsed the bug. |

Route changes were already announced correctly by moving focus to the view heading (§38's `_firstRouteDone` block). The live region was redundant *and* harmful. `tabindex="-1"` stays, because that focus move depends on it.

`test-a11y-tree.mjs` now asserts **no live region wraps a view** — a region containing a heading, over 400 characters, or more than three children fails. Presence is not correctness, and the test that endorsed the bug now catches it.

### How it was run

NVDA 2026.1.1, downloaded from nvaccess.org and **Authenticode-verified as NV Access Limited** before executing. Configured with the `silence` synthesizer — no audio on the machine — and `loggingLevel = DEBUG`, which still writes every speech sequence to `%TEMP%\nvda.log` as `Speaking [...]`. `tools/nvda-drive.ps1` focuses the app, sends keystrokes and extracts those sequences: the exact words a user would hear, in order, with no audio capture required.

### What did not get done, and why

**Only flow 1 was completed.** Flows 2 and 3 were repeatedly broken by Windows notifications *from this agent's own tooling* stealing foreground focus mid-run — which both misdirects the keystrokes and pollutes the transcript, since NVDA dutifully announces the notification instead. That is an environment problem, not an app problem, and it is not worth more automation effort: **NVDA is now installed and configured, and walking those two flows by hand with audio on takes about five minutes and is a better test than any harness.**

Recorded rather than quietly dropped, because the ask was three flows and one was delivered.

### Four self-inflicted faults along the way

A portable NVDA copy that silently refused to start (my hand-written `nvda.ini` used `schemaVersion = 13`; the real value is **22**) · an ini patch that moved `schemaVersion` inside `[general]`, where it is invalid · a transcript path written with doubled backslashes · and a line-based edit that split on a newline my own earlier bug had introduced. None touched the app; all cost time.

### State

**35 sections. Eleven suites** — all passing. The desktop app, APK/AAB and standalone file were rebuilt after the fix.

### The lesson

§50 narrowed the screen-reader gap with the computed accessibility tree and said honestly that it *"cannot tell you whether the experience is usable"*. That caveat was not boilerplate. **The single worst accessibility defect in this app was invisible to every automated check, including the one written specifically to find accessibility defects, and took about twenty minutes of a real screen reader to expose.** Some things cannot be inferred from structure. They have to be heard.

---

## 52. Flows 2 and 3 Walked with NVDA (session 46)

**Ask:** walk flows 2 and 3 with the screen reader and report back.

Done. Blocked before by Windows toasts stealing foreground focus, so they were suppressed for the run (`ToastEnabled=0`, restored afterwards) and the walk moved to a real Chrome window driven by Playwright — NVDA reads Chromium natively, and precise focus beats blind tabbing.

### One genuine defect: navigating to Forms announced nothing at all

`#/forms` rendered its title as **bare text in a `<div class="section-title">`** while every other view wraps it in an `<h2>`. The router focuses `"h1, h2"` inside `#route` after each render to announce the new view. With no heading it found nothing, focus never moved, and **arriving at Forms was completely silent** — a screen-reader user had no way to know the page had changed.

Every automated check passed it: the topbar `<h1>` satisfied "exactly one level-1 heading", and a *missing* `h2` is not a heading-level *skip*. Fixed, confirmed with NVDA (`FORMS TRAINER | heading | level 2` where there was silence), and `test-a11y-tree.mjs` now asserts **every view has a heading the router can focus** — all 35 pass.

### Both flows otherwise read well

| Step | NVDA says |
|---|---|
| Navigate to Board Prep | `BOARD PREP \| heading \| level 2` |
| Focus the card | `🟡 Intermediate` · the question |
| Space | `Answer revealed.` |
| Grade with `3` | `Marked known. Next card.` |
| Navigate to Forms | `FORMS TRAINER \| heading \| level 2` |
| Tab the form list | `DA Form 4856 · MAR 2023 \| Developmental Counseling Form \| Records developmental counseling — the leader's tool… \| ATP 6-22.1` |

The flipped card announces with real structure — `Answer content, scrollable | region`, the acceptable and verbatim answers, `KEY POINTS | list`, then `Needs Help | button`, `Somewhat`, `Know It`, `Down Cold`, `Star this card | toggle button | not pressed`. That is genuinely good, and it was already good.

### Four "findings" that were my harness, not the app

Worth recording, because three of them looked like serious defects:

1. **NVDA reading the whole Settings page** — thousands of words. Did not reproduce under clean navigation. The first walk matched `.nav button` by text and hit the **collapsible group headers** ("BOARD PREP", "ACCOUNT"), which expand a group rather than navigate, so it churned focus around Settings instead of going where I intended.
2. **A corrupted form description** (`s tool to give purpose…",`). The string is perfect. NVDA logs Python-repr style and switches to **double** quotes when a string contains an apostrophe; my single-quote parser split `the leader's tool` mid-word.
3. **"Grading a card announces nothing."** It announces correctly. My selectors used `#view`, **which does not exist** — the container is `#route`. Focus never landed on the card, so the keystrokes went nowhere.
4. The answer being announced twice — an artifact of the same focus churn as (1).

**Four apparent app defects, three of them mine.** Each was checked before being reported. Had any been "fixed" on first appearance, the result would have been damage to working code.

### State

**35 sections. Eleven suites, all passing.** Desktop, APK/AAB and standalone rebuilt.

### The tally that matters

Across §51 and §52, running a real screen reader over this app found **two genuine defects** — the `#route` live region reading whole pages aloud, and Forms announcing nothing on arrival. Both were invisible to axe-core, to the keyboard audit, and to the accessibility-tree audit written specifically to find accessibility defects. Both took minutes to expose once something actually spoke the interface.

It also produced four false alarms, every one of them a fault in the instrument. **That ratio is the honest picture of screen-reader testing: it finds what nothing else can, and it lies to you constantly.** Check before you fix.

---

## 53. Production UX Pass — Three Shipped Bugs and the First-Run Experience (session 47)

**Ask:** tighten UX/UI toward production quality, with 1:1 parity across every platform fork.

Method: no guessing — a 48-shot screenshot matrix (14 sections × 3 real viewports × app states), reviewed against the friction points already on record. The matrix paid for itself immediately: **its own failures exposed two shipped bugs, and a screenshot exposed a third.**

### Three real bugs, all shipped in v1.2.0

1. **First-visit reload.** On a hosted first visit the service worker activates ~2s after load, `clients.claim()` fires `controllerchange`, and `pwa.js` reloaded the page — right as a first-time user tapped an onboarding card. Found because the screenshot script died with *"execution context destroyed"* at exactly that moment. Reload now applies only when an update replaces an existing controller, never the first claim.

2. **Navigation landed mid-page.** Settings' screenshot arrived scrolled halfway down. `route()` *does* reset scroll — the culprit was §49's scrollhint calling `scrollIntoView()` on the active tab, which scrolls **every ancestor including the page** to reach a strip low in the view. Verify-the-verifier, in reverse: my own feature, caught by my own audit. Now horizontal-only via the strip's `scrollLeft`.

3. **Home rendered twice at boot.** The a11y sweep flagged two of every Home control. `app.start()` sets the default hash *and* calls `route()`; the hash-set fires `hashchange` → second `route()`; two **async** renders interleave — the second's `clear()` wipes the first's early output, then both keep appending. The same race fires on rapid nav taps between async views, so it was latent everywhere. Fix: every render gets its own frame inside `#route`, so a superseded render appends only into a detached node. Verified against both the boot path and a 10ms double-nav.

### First-run experience, rewritten from evidence

The screenshot of a brand-new user's Home was damning: the **first element on the page was a bare `mm/dd/yyyy SET` strip** with no context, followed by an alarm-red **"1014 board cards due for review — large backlog"** (a card with no SRS record is "due", so day one = the entire deck), and a red **ACTION REQUIRED** alert about incomplete mandatory training — *all before the app had introduced itself.* The app scolded new users for not having used it yet.

- Hero first; the board-date row moved below it.
- A never-graded deck is an **invitation**: *"1,014 board cards ready to study — start with 20 and the schedule builds itself"*, green, star icon. Urgency copy returns only once real grading history exists.
- The training panel scales with history: never-started → neutral *"UNIT TRAINING — 8 modules available, each checks off at 80%"*; started-with-stragglers keeps the loud treatment. `role="alert"` → `role="status"` either way — an alert interrupts a screen reader on every Home visit.
- *"Welcome back, KIOSK MODE."* — the greeting now excludes placeholder profile names.

### Settings, half the length

The 24-theme wall (name + four swatches + blurb, always rendered) made Settings the longest page in the app. It is now a **single summary row** — current theme's swatches + name + "Change theme ▾" — expanding to the full grouped picker on demand. Verified end-to-end: collapsed by default, 24 themes on expand, switching works, summary tracks the choice. Also: the tier filter no longer displays "(E1–E6)" against the E1–E9 branding — display copy only; §35's load-bearing filter key untouched.

### Housekeeping forced mid-session

C: hit **0 bytes free** mid-pass. Cause: my two emulator AVDs (9.9 GB) — plus a headless qemu from a prior session **still running and holding RAM images**. Both AVDs deleted (device testing moved to the real Fold 5 and Tab S9 FE), process killed, ~10 GB recovered.

### State

Eleven suites passing, **zero warnings**. All forks rebuilt from the same source and re-verified; parity is structural, and proven per-fork by the standalone/`file://`, web, and desktop-CSP suites.

---

## 54. Fullscreen Study — Theater Mode for the Board Drill (session 48, v1.3.0)

**Ask:** a YouTube-style fullscreen toggle on the Board Drill cards, so a card can fill the screen with nothing else competing for attention. Build, push, deploy to every fork and the connected tablet.

### The design decision that keeps it 1:1 across forks

The **guaranteed layer is CSS**: `html.qz-theater` turns the card wrap into a fixed overlay painted with the app's own `--bg` token, **covering** the topbar, nav and filters rather than hiding them. An opaque cover needs no knowledge of what sits underneath, so it is correct in all 24 themes and behaves identically on `file://`, hosted PWA, Windows and Android. The **Fullscreen API** (true device fullscreen) and **Android immersive bars** (`G.native.setImmersive` via the StatusBar plugin) are progressive enhancement layered on top — where a runtime lacks them, the CSS alone still delivers the feature. iOS's missing element-fullscreen therefore costs nothing.

### What stays visible

The study loop is the point, not a distraction: the card, flip/prev/next, the four grade buttons, and the star all remain. Everything else is under the overlay. The toggle (`⤢`/`⤡`) rides in the card's nav row, media-player style; the card grows to `clamp(340px, 66vh, 800px)` with a type bump.

### The exits, all of them

One escape = one full exit, from any entry point: the button · **Escape** (document-level, wired once — the drill re-renders per visit and per-render listeners would pile up) · a **system fullscreen exit** (`fullscreenchange` sync, so Esc inside true fullscreen doesn't strand the overlay) · **Android Back** (`closeTopLayer` peels theater before dialogs-then-history) · and **navigation** (`route()` exits it — a fixed overlay must never outlive the view that owns it). Grading advances cards *without* leaving theater, which is the whole workflow.

One stacking subtlety caught before it shipped: toasts are `z-index: 50`, the overlay is 800 — grade feedback would have silently vanished in fullscreen. `html.qz-theater #toast { z-index: 900 }`.

### Verified

New `tools/test-theater.mjs` — 14 assertions: button present and relabelling, overlay covers the viewport (geometry *and* a topbar hit-test), opaque themed background, flip/grade/advance inside theater, next card unflipped, toast above overlay, Escape exits, navigation cleans up, zero console noise. **Twelve suites now, all passing.**

**v1.3.0** across every version surface (app constant, package.json, Tauri, Cargo, Android 10300). `releases/v1.3.0/` with fresh checksums; the stale Fold watcher was killed before it could install the old 1.2.0 on reconnect, and re-armed for 1.3.0.

---

*This masterfile amends in place going forward per project convention — do not create parallel differently-named handoff files. Fold any stray file into this one and delete it.*


## 7. MOS Career Center (new this session)

**What it is:** A full Military Occupational Specialty career-planning module, added in response to a user-supplied MOS/reclassification research document ("Full Enlisted MOS List & Reclassification Reference (2026)"). Scope judged large enough to warrant a new top-level app section rather than folding into an existing one.

**Nav/route:** `#/career`, labeled "MOS" in the side nav (icon: ⚙), registered in the `ROUTES` array alongside Develop/ETS.

**Data:** New `career` key added to the `window.GUIDON_SEED` object (sibling to `acronyms`, `transition`, `resources`, etc.), threaded through `state.seed.career` in `loadContent()` and exposed via a new `store.career()` accessor. Multi-file build path also updated (`data/career.json` + fallback default) for parity, though the shipped build is single-file.

**Content (as of this session):**
- **163 MOS entries** across **27 CMF groupings** (CMF 11 Infantry through CMF "other" — recruiters, career counselors, linguists). Each entry: `code`, `title`, `cmf`, `lineScore` (ASVAB), `opat` (physical demand category), `notes`, `status` (`normal` / `shortage` / `overstrength` / `application`).
- **FY26 shortage/growth snapshot**: priority reclass-in MOSs (13F/13J/13M, 14E/14T, 25D/25H, 35S, 89D, 17C, 40D) and overstrength/restricted MOSs (19D, 31B, 46T, 88H, 92S, 35P), plus an SRB/Quality-Tier explainer. Explicitly flagged as perishable — re-verify against the live MILPER message via a Career Counselor.
- **Army-wide reclassification policy** (not MOS-specific, always shown): the three-gate rule (out-call + in-call + line-score match, checked via RETAIN), governing regs (AR 614-200, AR 601-280, DA PAM 611-21, DA PAM 601-280, AR 600-60), application/board MOS list, involuntary/MAR2 reclass, Reserve Component (ARNG/USAR) differences, systems/POCs (RETAIN, IPPS-A, ATRRS, AskHRC), and timing guidance.
- **NCOES/promotion ladder** (grade-based, all MOSs): E1→E9 progression with system type (automatic/decentralized/semi-centralized/centralized) and PME gate at each step (BLC/ALC/SLC/MLC/SMC).
- **Warrant officer feeder pathways**: 26 WO MOS entries mapping enlisted feeder MOSs to WO tracks (aviation, intel, cyber/signal, ordnance/maintenance, logistics, HR/band, Special Forces 180A).
- **Civilian certifications / transferable skills by CMF**: illustrative, non-authoritative starting points (e.g., CompTIA Security+/Network+ for 17/29 Cyber, NREMT for 68W, ASE for 91-series mechanics, CDL for 88M). Explicitly labeled as illustrative — points the user to Army COOL (cool.army.mil) as the authoritative source, since this mapping was not in the source research doc and reflects reasonable general knowledge rather than official Army data.

**UI behavior:** User types or selects their MOS (datalist-autocompleted against all 163 codes); the page shows CMF, ASVAB/OPAT/status badge, notes, civilian-cert suggestions for that CMF, and WO feeder pathway if applicable. Below the MOS-specific card, the Army-wide reclass policy, FY26 snapshot, and NCOES ladder panels always render (they're not MOS-specific). Prefills from the user's saved profile MOS (`profile.mos`, set during onboarding) if present.

**Onboarding integration:** The existing onboarding "Your role" step already had a free-text MOS field (`data.mos`) — this session added a `<datalist>` of all 163 MOS codes to that same input for autocomplete, without changing its storage/behavior.

**Known limitations / follow-ups:**
1. Civilian-cert mapping is at the **CMF level**, not per-MOS — a reasonable granularity trade-off given 163 MOSs, but a future pass could go MOS-specific for high-traffic codes.
2. FY26 shortage/growth and SRB figures are a **point-in-time snapshot** from the source research doc — these are explicitly perishable (the doc itself says MILPER messages supersede roughly every 6 months) and will drift from reality over time. Consider a `generatedAsOf` refresh reminder pattern, same as the Points module.
3. The WO-feeder matching logic in `G.career`'s render function does simple substring matching against `feeder` arrays — works for the current dataset but is not bulletproof if MOS code formats vary; spot-check before extending.
4. Not yet cross-linked from the Profile view or the existing Transition/ETS module's "career" sub-tab (which covers post-ETS civilian career paths, not in-service MOS/reclass) — a future session could add a "View your MOS Career Center" link from either.

---

## 55. The Icon System, and Legibility as a Test (session 49, v1.4.0)

**Ask:** replace every placeholder glyph with genuine icons — premium and dynamic, breaking none of the 24 themes — and fix training scenarios rendering dark regardless of theme; make "all text legible in every theme" true and provable.

**G.icons — theme-proof by construction.** ~50 Feather-idiom stroke icons (24×24 grid, 2px stroke, round caps) drawn in `currentColor`: an icon is exactly as legible as the text next to it, in every theme, with zero per-theme work. Geometry lives in `app-modules/icons.js`; the build inlines it into every fork. The retirement path for the dingbat era (◧ ◎ ⚑ ⎙ ↺ ⇩ …) was a `gi:` prop on `util.el()` — `{ gi: "printer", text: "Print plan" }` — so 111 call sites converted without reshaping any of them: nav rail + group chevrons, topbar, hero quick-nav, the whole Board Drill control surface, print/export/import/replay, warnings, scene tags, citations, expanders (which now rotate in place via CSS keyed off `aria-expanded`, replacing textContent ▸/▾ swaps that would have wiped the svg). The traps: `syncFsBtns`, the timer/star/due-chip relabels — every dynamic `textContent` write on an icon-bearing control became `replaceChildren` with the icon rebuilt. Accessible names live on the OWNING control (`aria-label`), never the picture (`aria-hidden` on every svg) — the a11y-tree suite holds that line.

**The dark-scenario root cause** was two hardcoded surfaces: the Train text-console (`#06090c`) and the CYOA scene banner (near-black gradient). Both are token-derived now — console tints `--text` 7% into `--bg`; banner mixes `--cyan`/`--amber` washes over `--panel`.

**Legibility became suite 14 (test-contrast.mjs)** — all 24 themes × the surfaces that matter (console, banner label, forms/primary/nav/topbar controls, dim text, board card, grade labels), measured as real WCAG ratios at steady state. Its own first run was the lesson: 67 failures, nearly all phantoms, because the app crossfades colors on theme change and `getComputedStyle` returns the mid-transition interpolated value (serialized as oklab). Transitions killed, the suite then found two REAL shipped bugs no eye had caught: `.forms-view .btn.primary` — amber text over the amber background the override forgot to remove, 1.0:1, invisible in all 24 themes — and the console's cyan system line at 2.58–2.77:1 on four light themes. Token mixes fixed both; the sweep passes clean.

**Method note for the file:** measurement artifacts and real bugs arrive in the same list wearing the same clothes. The discipline that separated them — refuse to "fix" anything until the number reproduces at steady state — is the same one from §48's audit: verify the claim's conditions before acting on the claim.

**Shipped:** v1.4.0 (Android 10400) across all forks; fourteen suites passing; releases/v1.4.0 with fresh checksums.

## 56. The Bridge the Backlog Carried for Thirty-Two Sessions (session 49, overnight, v1.4.1)

Session 17's team review deferred "extending 4-level SRS grading to Quiz Mode/Mock Board" as a different interaction paradigm. It sat in `deliberatelyDeferred` while the drill's scheduler matured. Tonight it shipped in ~40 minutes, and the reason it stayed small is the reason it waited: the right shape was never "extend grading INTO the quiz" — it was one write-through function, `G.board.noteExternalResult(id, grade)`, closing over the drill's own `schedule()` and `saveSrs()`. One scheduler, one store, zero duplicated math.

**The design decision that matters is asymmetry.** Mock Board is genuine recall — the Soldier answers aloud, then self-judges — so it moves cards in both directions, with "Nailed it" capped at Know It (Down Cold remains an explicit claim made on the card itself). The multiple-choice quiz is recognition, not recall: it can only DEMOTE — a wrong pick or a timeout grades the card Needs Help, due now. A correct pick writes nothing, and the results screen tells the user both facts rather than leaving the coupling implicit. `test-bridge.mjs` (suite 15) pins the API semantics and drives a live quiz click through the bridge.

Also closed: §7's follow-up #4 — the MOS Career Center is now cross-linked from the profile header (the MOS itself is the link) and from Transition's Career tab, which is post-ETS civilian pathways and now offers the staying-in fork (reclass, shortage MOSs, warrant packets) at the top.

**Method note:** the backlog entry aged well BECAUSE it recorded the reason for deferral ("different interaction paradigm"), which is exactly the constraint the eventual design answered. Write down why a thing waits, and the wait does design work for you.

## 57. Hands-On Device Audit — One Real Bug, One Ruled-Out False Alarm (session 50, v1.4.2)

The ask was concrete: photograph the app running on the actual Tab S9 FE and Galaxy Z Fold 5, find real deficiencies, fix them, ship everywhere. This is different from every prior verification pass this project has run — Playwright's synthetic viewports are a model of a device; this was the device.

**Tooling note first, because it mattered.** Tapping real hardware by eyeballing screenshot pixel positions and rescaling for display-vs-actual resolution is exactly the kind of manual coordinate arithmetic that quietly drifts wrong. `uiautomator dump` gave exact element bounds from the live accessibility tree, and tapping the center of a real bound eliminated an entire class of "why didn't that button register" debugging. Screenshot-driven QA on real Android hardware should reach for this first, not screenshot-and-guess.

**The bug:** the Fold's cover screen (344px, the narrowest real viewport this app ever renders on) truncated the topbar wordmark to "GUI…" and "LEADER D…". The accessibility tree proved the full text was present — `GUIDON` and `LEADER DEVELOPMENT · E1–E9` both showed complete in the dump — so this was pure visual CSS clipping, not a data or a11y problem. Root cause: `#topbar-username` already had a `max-width:480px` hide rule (added in an earlier session for exactly this "phones need the room back" reason), but the "Online" status chip beside it did not, and the chip alone was enough fixed-width chrome to starve the brand name. Fixed by extending the existing rule to the chip. `test-responsive.mjs` (suite 16) pins the wordmark at 344/360/412px, the breakpoint boundary at 480/481px, and desktop.

**The near-miss:** the Board Prep tab strip looked hard-clipped mid-word ("MOCK BOAR|"), which would have been a second bug — except it wasn't. Cropping and zooming the same screenshot 2x revealed a genuine soft alpha fade already in effect, and grepping the source found why: §41 had already solved this exact problem, down to a code comment naming the 344px Z Fold scenario specifically, with its own dedicated suite (`test-scrollhint.mjs`) already passing. The lesson for this file: **a screenshot glanced at once can look identical for "broken" and "subtly working."** The discipline that separated them was the same one from §48 and §55 — verify the failure reproduces under the real conditions before spending effort "fixing" it. Zooming in cost thirty seconds; a wrong fix would have cost a rebuild-and-redeploy cycle for nothing, or worse, disturbed a deliberately-tuned mask that was already correct.

**What held up without changes:** the flashcard, star toggle, all four icon-bearing grade buttons, and the full prev/flip/next/fullscreen nav row — the exact UI [[icon-system-legibility|§55's icon work]] touched most — rendered cleanly at the Fold's 344px extreme. That is the real proof the icon system is theme- and viewport-proof by construction, not merely proof against Playwright's synthetic widths.

**Shipped:** v1.4.2 (Android 10402); sixteen suites, 179 assertions, all passing; releases/v1.4.2 supersedes v1.4.1; reinstalled on both physical devices via adb.

## 58. The Second Half of the Same Screenshot (session 50, continued, v1.4.3)

§57's audit found the topbar bug and closed. But the very first screenshot taken that session — before Guest Session was even tapped — had shown something else: the onboarding screen's third mode card, its description text sitting partway behind the Fold's translucent system nav bar. That observation got set aside while chasing the topbar and tab-strip questions, then picked back up once those closed out, rather than dropped.

Worth being precise about severity here, because this one is NOT the same class of bug as §57's. Scrolling reveals all three onboarding cards in full — nothing is actually unreachable. The defect is narrower: the first thing a new user sees has no visual cue that scrolling helps, and a card ending mid-sentence behind a system bar reads as broken on a first glance even though it isn't. That distinction is why it got its own smaller fix rather than being folded into the topbar's — a genuine access bug and a discoverability rough edge call for different levels of urgency, and conflating them would have overstated one or understated the other.

Root cause was almost identical in shape to §57's, though: `.ob-wrap` had a fixed 40px bottom padding, sized for visual breathing room and never intended to also clear a translucent system bar. `.main` and the nav rail had already solved exactly this — `padding-bottom: calc(Npx + env(safe-area-inset-bottom))`, additive rather than `max()`, because the view needs BOTH the margin and the clearance, not whichever is larger. Applying an established idiom rather than inventing a new one kept this a one-line fix.

**Shipped:** v1.4.3 (Android 10403); sixteen suites still passing; releases/v1.4.3 supersedes v1.4.2; reinstalled on both devices.

## 59. Forty-Nine Agents, Nine Real Bugs, and a Bug in the Auditor (session 51, v1.4.4)

With both physical devices briefly offline, the session pivoted to what didn't need them: a parallel workflow fanning 49 agents across a truncation sweep (all 35 routes at the Fold's 344px width), a legibility sweep (8 routes x 6 themes `test-contrast.mjs` had never once rendered — Search, Settings, Records, Calendar, Profile, Doctrine, Currency, Leader), and a source-hardening review of everything this session had touched — followed by independent adversarial re-verification of every candidate before any of it was trusted.

**The nine confirmed findings shared one root cause**, and it's a useful one to have on record: this codebase already solved "raw accent color used as text fails 4.5:1 on light themes" once, with a documented `--ink-*` color-mix system built for exactly that failure mode. The search-view filter chips and a section-heading class simply never got migrated to it when it was introduced — the fix existed in the file the whole time.

**Fixing it surfaced a second, worse bug underneath**, which is the more important lesson: swapping the search chips' text color to `--ink-*` fixed the reported failures, but a verification sweep across all 24 themes (not just the two flagged ones) caught the active chip's background collapsing to 1.01:1 in `squadron-blue`. Root cause: the background was a literal `rgba(255,176,32,...)`, hardcoded on the assumption that "amber" is always orange — false in a theme that reassigns `--amber` to blue for its own branding. Same shape of defect as the forms-button bug in v1.4.0 (§55) and the hardcoded-dark surfaces before that (§54-adjacent) — a color baked in as a literal instead of derived from the token that's supposed to govern it. The fix pattern is now three-for-three: when a color looks right in the themes you happened to check, sweep all 24 before trusting it.

**`.fin-h` almost went the wrong way.** The obvious fix — swap raw `--cyan` for `--ink-cyan`, same as the chips — traded a 2.94:1 light-theme failure for a 1.31:1 dark-theme one. The `--ink-*` blend's own code comment says it was reasoned about for "warm-toned themes (field-manual, desert-cadence, sepia-study)" specifically; it had never been swept against all 24. This is a section label, not a color-coded semantic, so it didn't need an accent at all — `var(--text)`, the one token everything else in the app already trusts, cleared 3:1 everywhere it was checked.

**Except the check itself was lying.** Verifying `.fin-h` at `var(--text)` reported ~1:1 on a dozen dark themes — a result that should be structurally impossible, since `var(--text)` is the app's own guaranteed-readable primary token. Tracing it down: `test-contrast.mjs`'s background-detection walk correctly finds a panel's real gradient stops and correctly breaks out of the ancestor walk once it has them — but then unconditionally appended a manufactured white fallback candidate regardless, and the ratio calculation always keeps the *worst* candidate. Light text against a bogus manufactured near-white "background" produces exactly the near-1:1 numbers observed, for any panel that has a gradient but no plain `backgroundColor` — which is most panels in this app. This is the second time this session a verification tool's own defect was caught before it produced a wrong fix (the first was recognizing the Board Prep tab-strip "clip" was a working fade, not a bug, in §57). The discipline both times was the same: when a number contradicts what should be structurally true, distrust the measurement before the code.

**Two test assertions tightened** for the same reason good coverage matters more than a green checkmark: `test-bridge.mjs`'s quiz-miss check counted total SRS records, which is tautological — a broken call site and a working one both looked identical to that check. Rewritten to spy on `noteExternalResult` directly. `test-responsive.mjs`'s `!s.truncated` silently treated a missing selector as a pass; tightened to strict `=== false`.

**Two real hardening gaps closed**, both in the "first thing a user sees" category: `.ob-wrap` had gained a bottom safe-area fix in v1.4.3 (§58) but never a matching top one, and the topbar subtitle was dropping its grade-range text below ~375px with no affordance — now wraps instead.

**Shipped:** v1.4.4 (Android 10404); sixteen suites plus new Search/Settings contrast coverage, all passing.

## 60. When the Auditor Runs Out of Budget, the Discipline Has to Survive the Auditor (session 51, continued, v1.4.5)

§59's 49-agent workflow deliberately deferred a broader sweep — 186 more raw-accent-as-text candidates, the same pattern already confirmed nine times over. Asked to run it, a second workflow fanned 122 agents across a sweep-then-verify pipeline and hit a wall neither prior workflow had: the account's weekly agent quota. 106 of 110 verify calls failed outright, mid-run, with no warning beforehand.

**What did NOT happen:** the sweep's 110 raw, unverified candidate findings did not get treated as confirmed bugs. That would have been the fast path — the sweep agents were independently-coded, generally competent, and their claims mostly-plausible. But "mostly plausible" is exactly the failure mode this file has warned about since §48: a measurement that looks right at a glance and is wrong underneath costs far more than the time saved skipping verification. Instead: the raw findings were recovered from the workflow's own journal (the harness persists every agent's return value regardless of whether the run as a whole completed cleanly — worth remembering next time a workflow dies mid-flight), deduplicated to 60 unique selectors, and re-verified by hand, since no more agents were available this week.

**The hand-verification pass justified the caution immediately — three times.** Writing one Playwright script to sweep 60 selectors across 24 themes surfaced results that looked wrong in ways a real design bug never would: a contrast ratio pinned at an impossible flat 1.00 across every one of 24 themes with wildly different accent colors (real bugs vary by theme; only a broken measurement stays perfectly constant). A cluster of *different* selectors converging on the *identical* ratio on the *same* theme (unrelated text/background pairs don't coincidentally match). And most tellingly: an element already fixed and already passing in an earlier session — the v1.4.0 forms button — suddenly reporting near-total failure on almost every theme. That last one was the clincher: a real regression of already-shipped, already-verified code is possible but should be treated as the LEAST likely explanation, not the first one reached for.

All three traced to the same root cause, three variations on one theme: compositing translucent backgrounds correctly is *hard*, and a walk that gets 90% of it right (finds the real ancestor, extracts real color values) can still be completely wrong in its final answer if the remaining 10% — whether a still-pending translucent layer actually got blended onto what's behind it, whether resolving via a plain solid color pushes anything into the candidate list at all, whether a decorative low-opacity glow gets mistaken for solid paint — is off. `test-contrast.mjs` itself, already part of the enforced sixteen-suite battery, carried the identical bug; found and fixed in the same pass, verified against a live regression before trusting anything built on top of it.

**Once the tool could be trusted, the sweep's actual signal held up:** eighteen confirmed real contrast bugs, same shape as v1.4.0's and v1.4.4's — raw accent color as direct text, unmigrated to the token system built for exactly this. Two needed a stronger local blend than the shared `--ink-red` token provides; rather than touch that token globally and risk quietly breaking every other place it's already passing, both got their own scoped `color-mix()`. Every one of the eighteen re-verified clean across all 24 themes before shipping — the same non-negotiable bar as everything else in this file's running account of this bug class.

**The standing lesson, restated once more because it keeps paying for itself:** the discipline that makes an audit trustworthy — verify before trusting, re-derive the number rather than accept it, treat "this looks wrong" as a reason to check rather than a reason to move past it — has to survive losing the tool that was doing the verifying. Running out of agents didn't lower the bar; it just moved who was holding it.

**Shipped:** v1.4.5 (Android 10405); sixteen suites passing.
