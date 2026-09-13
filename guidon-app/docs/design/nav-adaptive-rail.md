# Navigation & Adaptive-Layout Overhaul: Smart Dock

Written 2026-09-12, in response to a direct request for "a serious overhaul
with intuitivism in mind" of GUIDON's navigation and its adaptability
across every phone/tablet/foldable size, rotation, and orientation —
explored first as four interactive mockups (`GUIDON Nav Lab`, an Artifact
covering Edge Rail / Smart Dock / Command Rail / Grouped Pill Dock, each
live-tested against real device dimensions including the Galaxy Z Fold 5's
cover and unfolded screens). **Smart Dock was the chosen direction.** Same
standing rule as every other design doc in this folder: nothing below is
implemented. No function, CSS rule, or persisted key named here exists in
`src/index.html` today unless a section explicitly says otherwise.

Every architectural claim below was verified against the real repository
this session — file:line references throughout are real reads, not
recollections. The doc is scoped to Smart Dock specifically; the Nav Lab
artifact remains available if a different or hybrid direction is wanted
later.

---

## 1. Why now, and what's actually wrong today

GUIDON's current nav (`src/index.html`, `NAV_GROUPS` ~34327, `renderNav()`
~34749) is not naive — it already has three real breakpoint tiers, a
7-group collapsible accordion, roving-tabindex keyboard nav, and an
explicit `html.device-fold-narrow` class set via
`navigator.userAgentData.getHighEntropyValues(["model"])` matching a Z
Fold 5's model number (`/^SM-F9\d{2}/i`, ~34628) specifically so its
unfolded-landscape width doesn't wrongly land in the wide desktop rail
tier. This is genuinely more foldable-aware than most production apps.

What it doesn't have, confirmed by direct reading:

- **No landscape-specific behavior below 600px.** `SIDEBAR_MQ` is a bare
  `matchMedia("(min-width: 600px)")` (~34640) — width-only. A phone
  rotated to landscape at, say, 480×320 still renders the `<600px` flat
  bottom bar (`.nav`, row layout, ~4350), which on a short landscape
  viewport eats a meaningfully larger fraction of vertical space than it
  does in portrait.
- **The "More" drawer is a flat, scrolling list** (`.nav-drawer`,
  ~4434–4502) of all 39 routes across 7 groups — functional, but slower to
  visually scan than a grid would be.
- **No personalization surface at all.** `NAV_PRIMARY_MOBILE` (the 4
  bottom-bar primaries, ~34652) is a hardcoded
  `["#/home", "#/train", "#/board", "#/settings"]` array — every user gets
  the same 4 regardless of what they actually use.
- **No platform-specific visual language.** One CSS treatment ships to
  Android (Capacitor), Windows (Tauri), and the iOS PWA alike. Reasonable
  as a starting point, but leaves real platform-convention recognition
  (Material's tonal-pill active state on Android, translucency on iOS) on
  the table.

None of this is a regression — it's scope the original Content-expansion
work never touched. This doc proposes closing it.

---

## 2. The chosen direction: Smart Dock, locked decisions

**Structure** (all four points below are the actual behavioral contract,
not just mockup flavor):

1. **Phone, portrait, `<600px` width:** bottom dock — Home (always
   present, unpinnable) + up to 4 user-customizable pinned slots + one
   "Sections" icon.
2. **Phone, landscape, even under 600px width:** the dock does not render.
   Nav becomes the same compact icon-only left rail the 600–799px tier
   already uses. This is the one genuinely new breakpoint rule — see §5.
3. **`600–799px` (small tablets, split-screen, Z Fold unfolded-landscape):**
   unchanged from today — compact icon-only left rail, `96px` wide
   (~4532–4571).
4. **`≥800px` (desktop, Z Fold unfolded-portrait and up) and
   `html.device-fold-narrow`:** the existing labeled accordion rail,
   visually refined (§4.3) but structurally the same collapsible groups.

**"Sections" replaces "More":** tapping it opens a full-screen grid of
group tiles (icon + label + route count per group) instead of today's flat
scrolling list — faster to scan 7 groups than 39 rows.

**Pinned favorites, app-wide:** any route gets a pin toggle. Pinned routes
surface as a dedicated section at the top of the `≥600px` rail. This is
useful independent of the dock and should render even for people who never
touch dock customization.

**Editable dock slots, phone-portrait only:** an "Edit dock" affordance in
the Sections grid lets a user add/remove which 4 routes sit in the bottom
dock (tap a tile while editing to add it, tap a dock icon while editing to
remove it — the exact interaction already proven out in the Nav Lab
mockup). Default slots stay `Train` / `Board Drill` / `Settings` +
whichever route the user pins first, so a fresh install behaves exactly
like today's hardcoded `NAV_PRIMARY_MOBILE` until someone opts in.

**Platform flavor:** Android gets a Material-3-style tonal pill behind the
active dock icon and a solid elevated surface (box-shadow, no blur); the
iOS PWA gets a translucent `backdrop-filter: blur()` bar with a
tint-only active state (no pill); Windows/Tauri desktop keeps the existing
rail with squarer corner radii. See §6 for the real detection question —
this is the one part of the design that isn't a slam dunk yet.

---

## 3. Data model additions

Two new pieces of client-side state, both `localStorage`-backed (matching
the existing `guidon:appearance:v1` convention, not IndexedDB — this is
UI preference, not study content):

```js
// guidon:nav:pins:v1  — array of route hashes, no cap enforced here
// (the dock UI caps its OWN 4 slots separately; a pinned-favorites
// list elsewhere in the rail can hold more than 4 without conflict)
["#/board", "#/doctrine"]

// guidon:nav:dock:v1  — exactly 4 hashes, phone-portrait dock slots.
// Absent key = use the existing NAV_PRIMARY_MOBILE default verbatim,
// so this ships with zero behavior change until a user opts in.
["#/train", "#/board", "#/settings", "#/doctrine"]
```

Both read through the same `try/catch`-wrapped localStorage-access
convention already used for `guidon:appearance:v1` and nav-open-groups
persistence (~34390–34399's own comment is explicit about why: a prior
enhancement-backlog finding required wrapping every localStorage access,
not just some).

No `GUIDON_SEED` change, no new IndexedDB store, no schema-migration
concern (`tools/schema-migration.mjs`'s test doesn't need touching) — this
is pure client-local UI state, same tier as appearance prefs, not user
study data that needs to survive a device change via backup/restore. Worth
a explicit product call: should pinned/dock choices be included in
`G.profile`'s existing backup/export payload? Recommend **yes** for
pinned favorites (a real, meaningful personalization worth carrying across
devices) and **no strong opinion** on dock slots specifically, since they
default sanely either way. Flagged as an open decision in §8, not resolved
here.

---

## 4. Component-by-component plan

### 4.1 Landscape-aware media query

Replace the single `SIDEBAR_MQ` check (~34640, ~34751) with two:

```js
const SIDEBAR_MQ = matchMedia("(min-width: 600px)");
const DOCK_MQ = matchMedia("(max-width: 599px) and (orientation: portrait)");
```

`renderNav()`'s branch becomes: `DOCK_MQ.matches` → bottom dock;
`SIDEBAR_MQ.matches` → existing rail tiers (600–799 / ≥800, `.matches`
distinguishes them exactly as today); anything else (i.e. `<600px` AND
landscape) → the same compact icon-only rail the 600–799px tier already
renders, reused verbatim rather than styled a third time. Both media
queries need the existing `addEventListener`/`addListener` resize-safety
pattern (~34783–34784) — a fold/unfold or rotation must re-render the same
way a width-only resize already does, and `closeNavDrawer()`'s existing
call must extend to whatever replaces the drawer (see §4.2).

### 4.2 Sections grid (replaces `.nav-drawer`)

New full-screen (not bottom-sheet) panel, reusing `util.modalTrap` for
focus-trap/Escape/restore exactly like `.nav-drawer` does today (~4438,
~34721), but laid out as `NAV_GROUPS.map()` → one tile per group (icon +
label + `hashes.length` count), each tile expanding inline to that
group's routes on tap — the same two-level structure the Nav Lab mockup's
Concept B "Sections" screen already demonstrates. `openNavDrawer()`
(~34714) is the function to replace/rename; every call site currently
targeting it is the "More" button (~34753–34757) and needs no other
change.

### 4.3 Dock + Edit mode

New `renderDock()` function, called from `renderNav()`'s `DOCK_MQ` branch
instead of the current 4-primaries-plus-More loop (~34752–34757). Reads
`guidon:nav:dock:v1` (falling back to `NAV_PRIMARY_MOBILE` verbatim),
renders Home + 4 slots + Sections. Edit mode is a boolean toggled from
inside the Sections grid (§4.2), not a separate route — matching the "no
new nav destination for a nav-editing feature" instinct from the mockup.

### 4.4 Pinned favorites section

A pin toggle button, added to whatever per-route row markup each view
already renders (Creeds/Recite/PRT detail panes, Doctrine cards, Board
Drill category rows, etc. — this is the one part of the design that
touches views OUTSIDE `renderNav()` itself, since "pin this route" needs a
UI surface somewhere a route is actually being looked at, not just inside
the nav rail). Recommend starting narrow: wire the pin toggle into
`renderGroupsInto()`'s own row rendering first (so every route is pinnable
from the rail/Sections grid itself, zero other-view changes needed), and
treat pinning from inside individual content views as a Phase 2 nicety —
this keeps Phase 1 entirely inside `renderNav()`'s existing footprint.

### 4.5 Platform-flavor CSS

New `data-nav-flavor="android"|"ios"|"desktop"` attribute on `<html>`,
set once at boot next to the existing `device-fold-narrow` detection
(~34624–34631) — see §6 for how it's actually determined. Three small,
additive CSS blocks (tonal-pill active state / blur+tint-only / squared
corners), scoped under this attribute, touching only the dock's own
`.active` styling — not a parallel stylesheet, not a fork of the whole nav
component.

---

## 5. Breakpoint plan, restated as one table

| Width | Orientation | Nav shape | Changed from today? |
|---|---|---|---|
| `<600px` | Portrait | Bottom dock (Home + 4 pins + Sections) | Yes — replaces flat 4-primaries-plus-More bar |
| `<600px` | Landscape | Compact icon rail (reused from 600–799 tier) | Yes — new rule, was flat bottom bar |
| `600–799px` | Either | Compact icon rail | No change |
| `≥800px` | Either | Labeled accordion rail, refined styling | Visual refinement only |
| `device-fold-narrow` (Z Fold 5, any width) | Either | Compact icon rail (existing override) | No change — this override already wins regardless of width, untouched |

The Z Fold 5 special case is explicitly **preserved, not touched** — its
whole reason to exist (~4657–4674's own comment) is that a nearly-square
tall unfolded panel needs the compact rail even past the 800px width
threshold, which is orthogonal to this doc's landscape-phone rule and
should keep working unmodified.

---

## 6. Open question: platform-flavor detection

Android detection is clean and precedented: `G.caps.fork()` already
derives `"web"`/`"standalone"`/`"guest"` from a build-time
`GUIDON_FORK` marker, and a real native-Android signal already exists via
whatever Capacitor's own platform check surfaces (worth confirming exactly
which API at implementation time — `Capacitor.getPlatform()` is the
standard one). iOS is the harder case: the app's only iOS surface is the
installed Safari PWA (confirmed elsewhere in this repo — no native iOS
build path exists), and iOS Safari does not implement
`navigator.userAgentData` at all (the exact API the Z Fold detection
relies on), so iOS can't reuse that clean pattern. Realistic options,
none perfect:

1. **UA string sniffing** (`/iPhone|iPad/.test(navigator.userAgent)`) —
   works today, but iPadOS deliberately masquerades as desktop Safari by
   default since iOS 13, so this under-detects iPads specifically (an
   acceptable gap, since iPad-width devices land in the `≥800px` rail
   tier anyway, where flavor differences matter least).
2. **A Settings toggle** ("Nav style: Auto / Android / iPhone / Desktop"),
   defaulting to a same-family guess — sidesteps the detection problem
   entirely at the cost of one more setting.
3. **Ship Android-flavor-only for v1**, defer iOS-specific flavor to a
   follow-up once the dock itself has shipped and settled — lowest risk,
   defers the hard call rather than answering it badly now.

No recommendation locked in here; flagging for the next session to decide
before Milestone 3 (§7) starts, not before Milestone 1.

---

## 7. Phased milestones

**Milestone 1 — Landscape-aware dock, no personalization yet.**
`DOCK_MQ`/`SIDEBAR_MQ` split (§4.1), `renderDock()` using the existing
hardcoded `NAV_PRIMARY_MOBILE` values (no `guidon:nav:dock:v1` yet),
Sections grid replacing the More drawer (§4.2) with **no** edit mode.
Ships a fully working, better nav with zero new persisted state — the
safest possible first cut, and independently valuable even if later
milestones stall. Test coverage: extend `test-nav-tier1.mjs`,
`test-nav-tier2ab.mjs`, and `test-fold-narrow-split.mjs` for the new
landscape-phone tier; new suite for the Sections grid replacing whatever
`test-nav-tier1.mjs` currently asserts about `.nav-drawer`.

**Milestone 2 — Pinned favorites + editable dock.**
`guidon:nav:pins:v1`/`guidon:nav:dock:v1`, the pin toggle inside
`renderGroupsInto()` (§4.4, narrow scope), Edit-dock mode (§4.3). New test
suite covering pin/unpin persistence and dock-slot editing end to end.

**Milestone 3 — Platform flavor.**
Blocked on §6's detection decision. CSS-only once that's settled — no new
persisted state beyond the `data-nav-flavor` attribute itself, which
doesn't need to persist (recomputed at boot every time, like
`device-fold-narrow` already is).

**Fold in while touching this code, not a separate milestone:** round
10's roadmap-audit (merging separately) found two real, adjacent bugs
worth fixing in the same pass rather than reintroducing them in new dock
code — PRT's Pause/Resume button never sets `aria-pressed`
(`src/index.html:32091`), and Recite's Timed Recitation Start/Stop buttons
drop keyboard focus to `<body>` on every click
(`src/index.html:32019–32036`). Neither blocks this doc's own milestones,
but both are exactly the kind of stateful-toggle-button pattern
`renderDock()`'s own active-tab state needs to get right the first time —
worth a quick read of `util.busyButton`'s post-round-10 fix (focus
restoration after disabling a button) before writing the dock's own click
handlers, so the same mistake isn't shipped a third time.

---

## 8. Open decisions

- **Backup/restore scope** (§3): should `guidon:nav:pins:v1` ride along in
  `G.profile`'s export/import payload? Leaning yes, not decided.
- **iOS flavor detection** (§6): three real options, no clear winner yet.
- **Pin toggle's visual home outside the rail** (§4.4): Phase 2 scope,
  not designed in detail here — which views get a pin affordance first
  (Doctrine? Board Drill categories? both?) is a real product call, not
  an engineering one.
- **Whether `NAV_PRIMARY_MOBILE` the constant should be deleted once
  `guidon:nav:dock:v1` ships**, or kept as the documented default value —
  recommend keeping it as the default (Milestone 1 already depends on
  this), just no longer the ONLY possible dock configuration.
