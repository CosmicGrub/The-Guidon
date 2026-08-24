# Rapid Fire — design spec

**Status:** Approved, ready for implementation planning
**Date:** 2026-08-23
**Author:** Brainstormed collaboratively with Claude Code

## Overview

Rapid Fire is a gamified, "Heads Up!"-style trivia mode built on top of GUIDON's
existing Board Drill flashcard system. It reuses Theater Mode's existing
fullscreen overlay and Board Drill's existing Q&A content, category filters,
and tab-switching pattern — it is a new way to *play* the existing card bank,
not a new content pipeline or a separate product.

Name note: the real "Heads Up!" mobile game is a trademarked product (Ellen
Digital Ventures). GUIDON's feature is deliberately named differently.

## Goals

- A fast, fun, social (and solo) way to drill the existing board-prep Q&A bank.
- Genuinely low build cost by reusing existing infrastructure: Theater Mode's
  overlay, Board Drill's category filters and Q&A data, the existing
  `store.normDifficulty()` scale, the existing Capacitor Haptics migration,
  and the existing cross-link (`G.nav.seed`) pattern.
- Zero risk to real study-progress data — entirely separate from the
  SRS/mastery system.

## Non-goals (explicitly out of scope for this design)

- Does **not** feed the real `attempts`/SRS mastery-tracking system. A Rapid
  Fire session has no effect on Progress, Readiness scores, or spaced
  repetition scheduling. This was a deliberate, explicit decision (see
  "Alternatives considered" below).
- Does **not** implement literal device-tilt/motion-sensor input in this pass
  (see "Deferred" below).
- Does **not** persist any Rapid Fire session data across app restarts —
  everything is ephemeral, in-memory only.

## The three modes

All three modes share **one round engine** — Party mode's round loop *is* the
shared engine; Solo and Team are thin variations on top of it, not three
parallel implementations.

### Party mode (the base loop)
`Setup → (first time only) quick-start explainer → Round → Recap`

- One device is passed hand-to-hand. The screen shows a full-screen prompt
  (the existing board-prep question text, and only the question — see
  "Question/answer length handling" below). Everyone else in the room gives
  clues out loud without saying the answer.
- The current holder can tap **Reveal answer** privately to check the real
  answer before judging, then taps **Correct** or **Pass** — self-judged by
  the group, exactly like the real game. There is no answer-checking logic;
  correctness is always a human call, same as real Heads Up!.
- Round has a timer (configurable, default 60s) and a running correct-count.
- A lightweight streak indicator ("🔥 3 in a row") reuses the same visual
  convention already used on the Progress trend chart's own streak display.

### Solo mode
`Setup → Round → Recap`

- No clue-giver step. Reuses Board Drill's existing flashcard self-grading
  pattern directly: flip, see the answer, judge yourself. Same round
  engine/timer/streak as Party mode, just without another player.

### Team mode
`Setup (with team names) → Team 1's Party-style turn → Team 2's Party-style
turn → repeat → Final Recap`

- Each team's turn is literally a Party-mode round under the hood — same
  engine, same self-judged Correct/Pass, same timer.
- Final Recap compares both teams' cumulative scores using the same recap
  component as Party/Solo, with an added per-team dimension.

## Input mechanic

**Decision: Tap Mode for v1.** Big on-screen **Correct** / **Pass** buttons,
identical behavior on phone, tablet, and desktop — no new device capability
required, no permission prompts, reuses the same tap-to-grade interaction
Board Drill's flashcards already use.

**Alternatives considered and deferred, not rejected:**
- *Forehead Mode (literal tilt)* — true to the real game (tilt down =
  correct, tilt up = pass, via `devicemotion`/`deviceorientation`), but
  phone/tablet-only, dead on desktop, and needs new sensor-permission and
  calibration work GUIDON has never done before.
- *Hybrid* (tilt where available, tap fallback everywhere else) — the
  eventual "do it right" version once the Tap Mode core engine is proven out;
  deliberately sequenced as a v2 layer on top rather than built simultaneously.

## Content source

**Decision: the existing Q&A board-prep bank** (`store.boardQuestions()`),
the same data Flashcards/Quiz/Mock Board already use — not the
Definitions/Terms glossary. Because Party/Team modes are self-judged by the
group (never programmatically checked), the longer-form Q&A shape works fine
for this format; there's no need for single-word/phrase content matching.

## Question/answer length handling

Real data from `store.boardQuestions()` (1069 questions), checked directly
rather than assumed:

| Field | Coverage | p50 | p90 | max |
|---|---|---|---|---|
| Question (`q`) | 1069/1069 | 59 chars | 111 chars | 244 chars |
| Full answer (`a`) | 1069/1069 | 262 chars | 605 chars | 929 chars |
| `acceptableAnswer` (shorter, board-ready phrasing) | 743/1069 (70%) | 145 chars | — | 700 chars |

**The question is essentially never a length problem** — only 3 of 1069
questions (0.3%) exceed 200 characters. The real concern is entirely on the
answer side, and only at the moment the holder needs to check it.

**Decision:** the answer is never shown automatically. The round screen
displays only the question by default, keeping it glanceable for the whole
room. A **"Reveal answer"** tap — used privately by the holder right before
calling Correct/Pass — shows the answer:

- Prefer `acceptableAnswer` when present (70% of cards, already short and
  board-ready).
- Fall back to the full `a` field when `acceptableAnswer` is absent (the
  other 30%).
- **Never truncate or alter the real content.** If the revealed text is
  genuinely long, the reveal panel scrolls internally — this app doesn't
  paraphrase board-prep material anywhere else, and Rapid Fire doesn't start.
- The question itself gets the same responsive-font treatment as the rest of
  this app's card UI for the rare 0.3% long-question case — full text, no
  truncation there either.

This means zero cards are excluded from the deck for being "too long," and
the glanceable party-game pace is preserved for the common case, since
answer length only matters at the moment it's deliberately checked — not
during the 99%+ of each round spent reading the (almost always short)
question.

## Where it lives

A **7th tab inside Board Drill**, alongside the existing Flashcards / Quiz /
Mock Board / Points / Readiness / Definitions tabs. Board Drill's tab
dispatcher is a `.segmented` button group with a `set(t)` function that
toggles `.active` and calls the matching `render*(body)` function
(`renderDrill`, `renderQuiz`, `renderMockBoard`, `renderReadiness`,
`renderDefinitions`, `renderPoints`) — adding Rapid Fire means one more
button (`rapidBtn`) and one more function (`renderRapidFire(body)`)
following that exact existing shape. No new dispatcher pattern.

Not gated by Guest/Personal/Kiosk profile mode, matching how every other
Board Drill tab is already universally available.

## Setup screen

Shown before every round starts. Every control changes real round behavior,
nothing decorative:

| Control | Options | Notes |
|---|---|---|
| Deck / Categories | All categories / Pick categories… / **Needs Work** | "Needs Work" reuses the exact term and data already shown on the Readiness tab's weakest-3-categories panel — not a new synonym for the same concept. Falls back to "All categories" with an inline note if the Soldier has no attempt history yet (fresh profile, nothing weak to surface). |
| Round timer | 30s / 60s (default) / 90s / Untimed | |
| Difficulty band | Match my rank (default) / All difficulties | Reuses `store.normDifficulty()`, the same scale Train/Quiz already share. |
| Passed cards | Requeue (may reappear, default) / Remove for this round | |
| Sound / Haptics | On (default) / Off | Reuses the real Capacitor Haptics call from the Tier 7 haptics migration — a distinct buzz on Correct vs. Pass. |
| Team names (Team mode only) | 2+ named teams | Start button stays disabled until both are filled in, matching this app's existing required-field form pattern. |

## Recap screen (after every round)

- Final score / correct count / elapsed time.
- **"Came up as Pass a lot" list** — the round's own local tally of
  frequently-passed cards, read back at the end. Does not touch any
  persisted store; purely a same-session summary.
- **Cross-link into real Flashcards/Quiz** for the weakest category that
  showed up in the round, using the existing `G.nav.seed()` cross-view
  handoff helper — the same established pattern used elsewhere in this app
  (weak-areas → Board Drill, PME bonus → BLC/ALC Prep).
- Play Again / New Deck buttons, returning to Setup.

## Data flow & state

Entirely **ephemeral, in-memory only** — no new IndexedDB store. Setup
choices, round state (timer, tally, streak), and the recap's data all live
in a local closure the same way Quiz's own in-round state already does;
nothing persists once the Soldier leaves the tab. This directly matches the
"fully separate from mastery tracking" decision above — there is no data
model to design here beyond transient in-memory state.

## Error handling

- **Category too small for the configured round length** — cap the round to
  the real available card count instead of erroring or looping past the end
  of the deck.
- **"Needs Work" selected with no attempt history** — fall back to "All
  categories" with an inline explanatory note, not a dead end.
- **App backgrounds mid-round** (phone call, notification, screen lock) —
  pause the timer on the page's `visibilitychange` event, resume on return.
  A Party round must not silently burn timer while the screen is off.
- **Team mode with fewer than 2 teams named** — Start button disabled until
  both names are filled in.

## Testing

Same Playwright-regression discipline already established across every
other feature in this codebase:

- Round-engine state transitions: timer tick, Correct/Pass tallying, streak
  counting.
- Mode composition is real, not just visually similar: Solo genuinely reuses
  Party's round loop; Team genuinely runs it twice with a running tally.
- "Needs Work" Setup option surfaces the real weakest categories and falls
  back correctly on a fresh profile.
- Recap's cross-link actually navigates to the correct category in real
  Flashcards/Quiz.
- Backgrounding-pause behavior via a real `visibilitychange` dispatch.
- **Zero writes** to the real `attempts`/SRS stores from any Rapid Fire
  action, across all three modes — this is the load-bearing regression test
  for the "fully separate from mastery tracking" decision.
- Answer-reveal field preference: a card with a real `acceptableAnswer`
  reveals that text, not the full `a` field; a card without one falls back
  to `a` in full, unaltered; the answer is never visible before the Reveal
  tap.

## Alternatives considered

**Should Rapid Fire results feed real mastery/SRS tracking?** Considered
three options: (A) always count toward real mastery, (B) never count — fully
separate, (C) count only in Solo mode (where self-grading is more reliable
than a rowdy group session). **Decided: (B), fully separate.** Keeps this
feature simple, avoids corrupting the mastery signal with group-judged
results of uneven reliability, and avoids adding a new data model this
design otherwise doesn't need at all.

**Where should it live in the nav?** Considered (A) a new tab inside Board
Drill vs. (B) a standalone top-level route. **Decided: (A).** Smaller build,
reuses Board Drill's existing tab-dispatcher pattern exactly, and Board
Drill's tab structure already exists specifically to hold different ways of
engaging with the same card bank.

**Content source?** Considered (A) Definitions/Terms glossary only
(best semantic fit for a guessing game), (B) the standard Q&A bank only, (C)
both, selectable. **Decided: (B).** The user's choice — reuses the bigger,
more central content set. Works because Party/Team modes are always
self-judged by the group, never programmatically checked, so the longer Q&A
shape doesn't need to be trimmed down to single words the way strict
answer-matching would require.

## Deferred to a later pass (v2 candidates)

None of these change the core round engine — they're all additive later
without a redesign:

- **Literal tilt/motion-sensor input** (Forehead Mode) or the tilt+tap
  hybrid, once the Tap Mode core is proven out.
- **A "steal" mechanic for Team mode** — if Team A passes, Team B gets a shot
  at the same card before moving on. Genuinely fun, but real added
  complexity: tracking cross-team state mid-turn, not a cosmetic add.
- **Celebratory flourish/animation** on a high-score round.
- Custom category weighting, a streak-multiplier scoring twist, saved custom
  decks, per-player avatars/names in Party mode.

## Implementation notes for the next phase

- `renderRapidFire(body)` follows the exact shape of `renderQuiz`/
  `renderMockBoard` in `src/index.html`'s Board Drill dispatcher (`set(t)`,
  around the `.segmented` button group).
- Mounts into the existing `html.qz-theater` fullscreen overlay — no new
  overlay/focus-trap/ARIA work needed.
- Reuses `store.boardQuestions()`, `store.normDifficulty()`, the existing
  category-filter UI, `G.nav.seed()`/`G.nav.consume()`, and the real
  Capacitor Haptics calls from the Tier 7 migration.
- No new IndexedDB store, no new native dependency, no new permission.
