# GUIDON — Project Map

**One-page-ish orientation to the whole project: every document, every feature, and exactly how the app is wired together.**
Read this first if you're new to the project. Read `GUIDON_MASTERFILE.md` for the full session-by-session *why*, and `ROADMAP.md` for what's next.

**Current build:** `guidon-app/` v1.5.0 — built from `src/`, not a single hand-edited file any more.
`npm run build` produces `dist/guidon-standalone.html` (~14.9 MB, `file://` ready) and `web/` (~12.6 MB, installable).
Also ships as a Windows `.exe`/`.msi` and an Android APK/AAB. See `GUIDON_DEPLOY.md`.

---

## 1. Every document, and when to read it

| Document | What it is | Read it when |
|---|---|---|
| **`guidon-app/`** | The app and its build. `src/index.html` + `src/app-modules/` → two artifacts. | You want to run, build or ship it. |
| **`GUIDON_MASTERFILE.md`** | Full architectural history, 42 numbered sections, one per major work session, with reasoning. | You need to know *why* something is built the way it is. |
| **`ROADMAP.md`** | Forward-looking: completed initiatives, the audit cadence as a standing practice, what's deliberately not built and why, what's next. | You're starting a new session and need to know where to pick up. |
| **`CHANGELOG.md`** | Session-by-session change log, newest first, more granular than the masterfile. | You want a chronological diff of what changed and when. |
| **`GUIDON_STATE.json`** | Machine-readable current state: build lineage, open items, content inventories. | You (or a script) need structured facts rather than prose. |
| **`GUIDON_PROMOTION_RESEARCH.md`** | Sourced research on AR 600-8-19 promotion points, with confidence levels per claim. | You're touching the Points/PPW calculator or need to verify a promotion-policy fact. |
| **`GUIDON_DESIGN_SYSTEM.md`** | Token reference, component inventory, the 24-theme system, architecture constraints. | You're touching CSS or building a new visual component. |
| **`GUIDON_DESIGN_HANDOFF.md`** | Context and landmines for a designer arriving cold — six things that have actually broken. | You're handing this to someone new for a design pass (e.g. Claude Design). |
| **`GUIDON_DEPLOY.md`** | How to host it, gzip/brotli setup, verification steps. | You're standing this up on a real server. |
| **`GUIDON_PROJECT_MAP.md`** | *This document.* Index + feature summary + wiring diagrams. | You want the 10,000-foot view before diving into any of the above. |

---

## 2. Feature set, by nav group

The app organizes its **35 sections** into **5 collapsible nav groups**:

### Board Prep
`Train` · `Board` · `Records` · `Calendar` · `Doctrine` · `Terms` · `MOI Import`
Scenario-based leadership training, a 984-card spaced-repetition flashcard drill with 4-level mastery grading, a rank-aware Promotion Points / PPW worksheet, a 353-entry doctrine reference, a 3,623-term acronym dictionary, and MOI Import — paste or upload a real board's Memorandum of Instruction and get a study dashboard plus an optional practice drill built from exactly the citations it assigns.

### Study & Skills
`Learn` · `Forms` · `Write`
Structured study paths, interactive replica DA forms (4856, 638, 31, and more), and guided writing help for counseling statements and award narratives.

### Leadership
`BLC Prep` · `ALC Prep` · `SLC & Beyond` · `NCOPDS Drills` · `Squad` · `Counsel` · `Develop` · `Risk`
The full NCOPDS ladder — **BLC → ALC → SLC → MLC → SMC** — each with its own prep module built from authoritative source documents (the BLC module specifically from the actual grading ISAP), plus a drills section that rehearses the real graded assessments (squad drill, PRT, information brief, essay rubrics, MDMP, and an interactive Land Navigation drill — azimuth, pace-count, grid-coordinate reading, all generated-and-checked), a counseling skill-builder, an IDP builder, and a risk-assessment worksheet.

### Career & Life
`MOS` · `Assignments` · `Channels` · `Money` · `Health` · `Fitness` · `ETS` · `Resources`
163-MOS career center, a "who do I see for what" channels reference (S-1, HRC, ATRRS, ATIS, career counselor), financial readiness, H2F wellness, ETS/transition timeline, and a curated resource directory.

### Account
`Progress` · `Currency` · `Author` · `Settings` · `Self-Test` · `Share & Install`
Progress dashboard with board-readiness scoring, a custom-content authoring tool, 24-theme appearance settings, an **on-device self-test suite** (11 automated checks + 9 manual protocols), and a hosted-access/install panel.

---

## 3. How it's wired — the module map

**34 JavaScript modules**, each an IIFE, all sharing one global object: `window.G`. A module cannot see another module's internals unless that module explicitly exposes something on `G`.

```
                         window.G  (the only shared surface)
                              │
   ┌──────────────┬───────────┼───────────┬──────────────┐
   │              │           │           │              │
 CORE          CONTENT      NCOPDS      SERVICES        SHELL
   │              │           │           │              │
 util          board        blc        modal            app
 db             progress    alc        selftest         views
 store          engine      slc        share            profile
 theme          curriculum  drills     backup
 (foundations)  dictionary  channels   reminders
                authoring              kioskBadge
                                       streak

 G.routes        <- the single source of truth for all 26 sections;
                    Demo Center derives its tour from THIS, not a copy
 G.renderBoardCountdown <- shared so Home and Board Prep show one countdown
 G.profile.cached()     <- synchronous profile read (async views can't await mid-render)
 G.modal.confirm/prompt <- themed dialogs replacing native confirm()/prompt()
```

**The rule that governs all of it, learned from two real bugs:** if module A needs something from module B, B must put it on `G` explicitly — `G.routes = ROUTES`, `G.renderBoardCountdown = renderBoardCountdown`. A `typeof X !== "undefined"` guard across that boundary does **not** throw an error if it's missing; it silently produces nothing. That exact pattern once emptied the entire Demo Center tour, and separately, once silently disabled a difficulty filter — both times with zero console output. **Expose things loudly; never guard for them quietly.**

---

## 4. How data flows — profile, board date, and the closed loop

```
  ONBOARDING
  (Personal / Guest / Kiosk)
        │
        ▼
  ┌─────────────┐        ┌──────────────────┐
  │   PROFILE   │◄──────►│   IndexedDB       │  Personal: persists
  │ rank · tier │        │ kv: "guidon:      │  Guest: in-memory only,
  │ MOS · board │        │  profile:v1"      │    never written to disk
  │ date        │        └──────────────────┘
  └──────┬──────┘
         │  read by ...
         ├─────────────────────┬─────────────────────┬───────────────┐
         ▼                     ▼                     ▼               ▼
   ┌───────────┐        ┌────────────┐       ┌──────────────┐  ┌──────────┐
   │   HOME    │        │ BOARD PREP │       │  ACTION PLAN │  │   IDP    │
   │ countdown │        │ → Points/  │       │ generated    │  │ tied to  │
   │ banner    │        │   PPW calc │       │ from profile │  │ ADP 6-22 │
   └───────────┘        │ advice     │◄──────┤ + board date │  │ competen-│
                         │ scales by │       │ + weak areas │  │ cies     │
                         │ proximity │       └──────────────┘  └──────────┘
                         └────────────┘
```

**Why this matters:** the board date isn't just a countdown — it drives the action plan's urgency, the PPW calculator's advice ("board in 5 days → verify IPPS-A now" vs. "board in 90 days → work civilian education"), and it appears on Home precisely because that's the screen a Soldier opens first. Building one loop meant re-exposing `renderBoardCountdown` across a module boundary — see §3.

---

## 5. How storage is split

```
┌─────────────────────────────────────────────────────────────┐
│  IndexedDB  (persists across sessions, survives app restart) │
│  ─────────────────────────────────────────────────────────── │
│  • Personal profile (rank, MOS, board date, action plan)     │
│  • Board card grades (1,014 cards × 4-level mastery)          │
│  • Settings (theme, appearance)                               │
│  • Self-test manual-check ticks                               │
│  • BLC / ALC / SLC self-check progress (independent keys)    │
│  • Custom authored content                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  sessionStorage  (cleared when the tab/app closes)            │
│  ─────────────────────────────────────────────────────────── │
│  • Demo mode selection (guided vs. free)                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  In-memory only  (never touches disk)                         │
│  ─────────────────────────────────────────────────────────── │
│  • Guest profile + its 4-item starter action plan              │
│    "Nothing is saved" for a Guest is a literal, enforced claim │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. How theming is wired

```
   33 CSS custom properties (the tokens)
            │
            ▼
   ┌──────────────────────────────────┐
   │  24 themes, each redefines all   │
   │  33 tokens                       │
   │                                  │
   │  14 "Standard" (original set)    │
   │  10 "Focus" (session 35 — built  │
   │      to one brief: promote focus,│
   │      readable at any brightness) │
   └──────────────────────────────────┘
            │
            ▼
   ~918 CSS classes consume tokens,
   never raw hex values
            │
            ▼
   Two rules that caused real bugs when broken:
     --btn-ink   → text ON an accent fill (not raw #000/#fff)
     --ink-*     → an accent used AS text (not the raw accent)
```

Light themes require **both** `data-theme="name"` on `<html>` **and** the `.light` class — one without the other is a broken hybrid that looks like a rendering bug and isn't.

---

## 7. Quick-reference numbers (re-verified live 2026-09-01, v1.5.0)

| | |
|---|---|
| Routes / sections | 39 |
| Nav groups | 5 |
| Modules on `window.G` | *not re-verified this pass — see note below* |
| Themes | 24 (14 Standard + 10 Focus) |
| CSS custom properties | *not re-verified this pass* |
| CSS classes | *not re-verified this pass* |
| Media queries | *not re-verified this pass* |
| Board study cards | 984 |
| Acronym dictionary | 3,623 terms |
| Doctrine entries | 353 |
| MOS entries | 164 |
| Scenarios | 182 |
| File size (installable bundle) | 12.64 MB raw · 3.44 MB gzip |
| Accessibility | 0 console errors/warnings across all 39 sections at 6 real device viewports (`verify.mjs`) |

**Note:** only the rows above with a real number were re-derived live for this pass (seed-content counts via direct JSON parse of `window.GUIDON_SEED`, route count and accessibility result from `tools/verify.mjs`'s own live output). The three rows marked "not re-verified" were carried forward unchanged from the last pass rather than guessed — re-derive them the same way (grep/count against the actual current build) before trusting them for a real decision, per this document's own §8 rule 1 and its own §9 correction history.
| Test suites | 11, all passing |

---

## 8. The standing rules that keep this project from drifting

Distilled from 37 sessions of actually hitting these:

1. **Verify the verifier.** When a result surprises you, check the test before you change the code. This project hit that lesson **ten separate times** before it became reflex.
2. **Settle after theme changes, not just navigation** — a theme switch triggers colour transitions across the whole UI; sampling too early produces phantom contrast failures.
3. **Never guard cross-module access with a silent `typeof` check** — expose explicitly on `G`, or the failure is invisible.
4. **Don't hand-maintain parallel lists** — the Demo Center tour derives from `G.routes`, not its own copy, specifically because a hand-copied list silently fell three sections behind once already.
5. **State confidence levels on researched facts** rather than presenting an estimate as verified — see how `GUIDON_PROMOTION_RESEARCH.md` handles the weapon-qualification hit tables.
6. **An unverifiable feature doesn't ship** — a QR encoder was built, tested by decoding its own output, found broken, and removed rather than shipped with a caveat.


---

## 9. Corrections applied 2026-07-26

This document had drifted. Every figure in §7 is now pulled live from the built
app rather than carried forward, and the following were wrong:

| Was | Is |
|---|---|
| `guidon_86.html`, a single hand-edited file | `guidon-app/` v1.2.0, built from `src/` into four artifacts |
| 26 routes | **35** |
| 290 doctrine entries | **336** |
| ~918 CSS classes | ~1,048 |

The lesson that keeps repeating in this project: **a hand-maintained number is a
number that will be wrong.** §33 hit it with the Demo Center tour, §46 hit it
with three test files each hard-coding "29 routes", and this document hit it
with all four figures above. Where it matters, derive it - `tools/declared-routes.mjs`
exists precisely so no test ever hard-codes a route count again.
