# PT Scheduler / Planner

Written 2026-09-14, in response to a direct request for an "all-
encompassing and intelligent" PT scheduler/planner that knows what the
calendar days call for and builds a proper PT plan per day, week, or
month — grounded in FM 7-22 and FM 6-22, with real breathing room for
variety and challenge. Same standing rule as every other design doc in
this folder: **nothing below is implemented.**

Explored via a 4-candidate design workflow (Reconcile-and-Extend,
Calendar-Intelligent-First, Template-Library-First, Leader-Led Unit PT
Calendar), each independently designed against a direct current-state
audit, then adversarially scored and synthesized. **Decisions below are
locked** (chosen by the user via multiple choice; all judge
recommendations were accepted).

---

## 1. Confirmed current state (the audit, not assumption)

- **`#/prt` Physical Readiness Hub**: `GUIDON_SEED.prt.drills` is real,
  populated, CI-gated data — but only ONE drill exists today ("pd", the
  Preparation Drill, 10 exercises). Has a genuinely working drill-runner
  (`prtRunDrill()`): real per-exercise timer, Pause/Resume/Skip/End,
  Standalone-vs-Combined rep toggle, 4-level self-grade feeding the app's
  SRS scheduler. The data model's own comments already anticipate more
  `drills[]` entries landing later with no rework needed.
- **`#/fitness` (ACFT/AFT)**: pure standards/reference browser. Zero
  periodization or workout-building logic.
- **Critical duplicate-data finding**: a SEPARATE, independent "PRT
  session builder" lives inside `#/drills` — a static `const PRT` object
  encoding the two full real ATP 7-22.02 sessions (Strength & Mobility;
  Endurance & Mobility) as ordered blocks. This is the ONE place in the
  app that already models a multi-drill "session" as real structured data
  — but it's a static checklist with no timer/reps/cadence, and it
  duplicates rather than reuses `#/prt`'s verified exercise data. **This
  reconciliation is the necessary first step for anything else here.**
- **No feature anywhere in the app reads day-of-week or a real calendar**
  to decide what content to surface, for PT or any subject. Reusable
  patterns exist though: `G.streak`'s DST-safe local-date math; the
  Weekly Study Goal's Sunday-anchored weekly-cadence UI (currently
  generic-training-only); `generateActionPlan()`'s days-until-boardDate/
  etsDate threshold logic.
- **`G.reminders`**: flat, single-date, non-recurring, already has an
  "acft" kind. **`G.notify`**: real Capacitor local-notifications wrapper
  (Android-only), schedules exactly one single-fire notification per
  reminder — the underlying plugin supports recurring ("every") schedules,
  but this wrapper has never used that option.
- **Doctrine already in the seed, zero code implements any of it**:
  `doc-pft-2` ("Planning a Unit Physical Training Program", FM 7-22 + AR
  350-1) narrates the real assess→identify-gaps→periodize→balance→
  schedule framework and the H2F 3:1 hard:recovery ratio. Board questions
  cover FM 7-22's 3-part session structure (Preparation/Activities/
  Recovery) and the current 5-phase H2F model (Initial/Sustaining Phase —
  the older Toughening/Sustaining/Combat APFT-era model is explicitly
  superseded; do not design around it). **FM 6-22 content specifically
  about a leader's responsibility to plan/conduct/police unit PT is
  thin-to-absent in the current seed** — this is a real, separate content
  gap this feature surfaces, not something to paper over with an
  unverified citation.

---

## 2. Locked decisions

### 2a. Content-authoring gating — **ship now with a placeholder table**

Reconcile the data model immediately using an explicit alias/placeholder
table for not-yet-authored drills, so `#/drills`' checklist and a first
scheduler pass can ship right away, with real drill content backfilled
incrementally without any further data-shape changes. This was the single
best de-risking idea across all four candidates — no other one offered it
— and it means the feature does not stall behind weeks of doctrine
research before a Soldier sees any value.

**Data model** (extending `GUIDON_SEED.prt`, not replacing it):
```
prt.drills[]   — add "ssd" (Shoulder Stability), "cd1"/"cd2" (Conditioning
                 1/2), "hsd" (Hip Stability), "mmd1"/"mmd2" (Military
                 Movement 1/2), "rd" (Recovery Drill, shared by both
                 sessions) — identical schema "pd" already uses:
                 {id, name, cadence:{slow,moderate}, repRule:{...},
                 exercises:[{name, counts, startingPosition,
                 movementDescription, source, sourceStatus}]}
prt.sessions[] — {id:"strength", label:"Strength & Mobility Session",
                 blocks:[{drillId:"pd"},{drillId:"ssd"},{drillId:"cd1"},
                 {drillId:"cd2"},{drillId:"rd"}]}, and the "endurance"
                 session mirroring it — this literally matches the block
                 order/labels #/drills' current hardcoded PRT const
                 already names, just referencing drillIds.
```
`#/drills`' hardcoded name-string arrays get replaced with a small adapter
reading `sessions[]`+`drills[]` that returns the identical shape the
checklist renderer already consumes — visually unchanged UI, one data
source underneath, so an exercise-name accuracy fix only has to happen
once instead of drifting between two copies (a real bug class today).
Not-yet-authored drills are referenced by a documented placeholder
`drillId` the UI can render honestly ("content coming") rather than crash
on — never a fabricated exercise description standing in for real
FM 7-22 text.

### 2b. Calendar intelligence — **defaults + a flagged history check**

Day-of-week template defaulting, plus days-until-target-event threshold
bias (reusing `generateActionPlan()`'s existing math — cheap, inspectable,
uses data the app already has), plus exactly one piece of real history-
awareness: a new, minimal `pt:history` log written by `prtRunDrill()`'s
existing completion hook, checked against the H2F 3:1 hard:recovery ratio
to surface a **non-blocking amber warning** ("this breaks the 3:1 ratio —
swap anyway?") — never an auto-adjustment. This gets meaningfully past
"static template" without taking on the combinatorial rule-interaction
risk of a full auto-adjusting decision tree (periodization phase, profile/
travel overrides, muscle-repeat avoidance, all interacting). That fuller
engine is real, valuable v2 work, explicitly deferred until a dedicated
test-fixture strategy exists for it — this codebase has been burned by
exactly this class of rule-interaction bug before (SRS lastGrade-vs-reps
fixtures), and that lesson applies deliberately here rather than being
relearned.

A missed day is read as a gap in history, never treated as "debt to make
up" — a plausible-sounding but doctrine-violating "catch-up" feature is
explicitly rejected.

### 2c. Interaction model — **hybrid: rule engine suggests, library stays browsable**

The chosen intelligence tier (2b) pre-fills a default every day from the
same session/template library, but every day remains a one-tap swap into
any other library entry — same underlying data, two ways in. This avoids
both failure modes named during design: a pure library caps how
"intelligent" the tool ever feels and offers no help when a real training
calendar doesn't match any pre-built shape; a pure rule engine demands the
largest new "why did it pick this" UX surface and the most rule-
interaction testing before it can be trusted.

### 2d. Schedule storage — **persisted, hand-editable**

A real per-date assignment table (day/week/month tiers), not computed
fresh on every view. New user-owned kv row, `"prt:plan:v1"`:
```
{ templateId, weekStart:"sun",
  days:{sun,mon,tue,wed,thu,fri,sat}: {type:"session"|"drill"|"rest"|"custom", ...},
  overrides:{ "<isoDate>": {...same shape...} } }
```
Every day slot is **always** written explicitly at creation time — never
left undefined. This directly applies the lesson from the app's own What's
New feature incident (an ambiguous "no record" state was indistinguishable
from a real prior state and caused a real shipped bug): an unset day slot
here could otherwise be misread as "user chose all-rest" vs. "plan was
never configured." Rest and `{type:"custom", label}` (for real PT GUIDON
can't model — a battalion run, an ad-hoc field session) are first-class
slot types for the same reason, never a blank cell.

**Flexibility, so this never feels rigid or joyless**: a one-tap Swap
between two days; a Shuffle that randomizes hard-day placement within the
week while still re-checking (never bypassing) the 3:1 ratio warning; a
Standard/Challenge/Light intensity dial reusing the existing Standalone-
vs-Combined rep-context toggle already built for `#/prt` — no new
exercise-science logic needed for "make today harder."

### 2e. Leader/group depth — **reused checklist + simple export/share**

Any assigned template surfaces `#/drills`' existing risk-assessment/AAR
checklist pattern as metadata (`leaderChecklist`) rather than inventing
new leadership UI or doctrine text. A leader can mark a plan shareable and
export it (JSON, or a readable roster sheet) for a squad to follow on
their own devices — **no Study Rooms real-time sync, no dedicated roster/
completion-tracking view, on day one.** A fuller squad-accountability
module (a real leader planning surface, per-Soldier completion/AAR
reporting) is a legitimate, larger, separate future decision — it
introduces genuine new privacy territory (storing other Soldiers' PT data,
the same class of concern the existing `#/leader` counseling-roster
already has to handle carefully) and real overlap risk with the cohesion-
mechanic work in `casualty-care-and-cohesion.md` §2c/2d. Not folded into
day one.

### 2f. Notifications — **ship on the existing single-fire pipeline**

Bulk-write one dated `G.reminders` entry (new `"pt"` kind) per assigned PT
day, through the exact same single-fire 09:00 path every other reminder
kind already uses — soft-warn near the existing 300-reminder cap. Real
recurring weekly notifications (extending `G.notify` with the Capacitor
plugin's `"every"` option, which this codebase has never exercised) are
explicitly deferred to a later, separately-scoped and on-device-verified
change — this app's own comments already flag a prior `SCHEDULE_EXACT_ALARM`
regression class, a real named risk not worth taking on for v1 of
something this routine.

---

## 3. Doctrine grounding, applied honestly

- FM 7-22's 3-part session structure ({prep, activity, recovery}) is
  enforced **structurally**, not just tagged: `buildWeekTemplate()` will
  not let a hard day exist without both a real prep and recovery block.
- Current 5-phase H2F model only (Initial Phase / Sustaining Phase) —
  never the superseded Toughening/Sustaining/Combat APFT-era terms.
- The "why this default" link on any generated day surfaces `doc-pft-2`'s
  own existing citation text (FM 7-22 + AR 350-1) rather than inventing a
  new claim.
- **On FM 6-22 specifically**: every candidate independently refused to
  fabricate a citation the seed doesn't actually have. The honest move,
  and the one taken here, is to **not** invent an FM-6-22 tie-in inside
  the scheduler itself, and instead spin out real, separately-researched
  FM 6-22-named seed content (a leader's responsibility to plan, resource,
  and conduct unit PT) as its own companion content task — see §4.

---

## 4. Companion task, not yet started

Author 2-3 real doctrine.entries cards citing FM 6-22 by name for a
leader's responsibility to plan/conduct/police unit PT (command PT policy,
risk management for PT, integrating PT into unit training management)
— needs real research before writing, not assumed from this design pass.
This is what makes the scheduler's "why this default" framing honestly
dual-sourced (FM 7-22 for the exercise science, FM 6-22 for the leader's
duty to run it) rather than only ever citing FM 7-22/AR 350-1 while the
user's own explicit FM 6-22 ask goes unaddressed in the actual shipped
content.

---

## 5. Open engineering risks, named rather than glossed over

- Deleting `#/drills`' hardcoded `const PRT` name lists is a change to a
  live BLC-rehearsal checklist — needs explicit test coverage proving the
  adapter renders byte-identical output before the old arrays are removed,
  not just "should look the same."
- The exercise-level remix/"Surprise me" randomizer concept (swap one
  exercise for a same-category alternative) assumes a same-category
  exercise taxonomy that isn't confirmed to exist anywhere in the current
  seed (only one drill, 10 exercises, exists today) — this needs its own
  content-modeling pass before it's buildable, not just UI work.
- A missed week's real behavior (explicitly: no smarter response than an
  unchanged template, by design in 2b) should be stated plainly in-app
  copy so it doesn't read as a bug to a user expecting more adaptivity.
- Authoring the 6 new drills (SSD/HSD/CD1/CD2/MMD1/MMD2, all FM 7-22/
  ATP 7-22.02-sourced) to the same fabrication-lint-verified standard as
  the existing Preparation Drill is real doctrine-research work and the
  likely long pole of this whole initiative — the placeholder-table
  decision (2a) exists specifically so this doesn't block everything else.
