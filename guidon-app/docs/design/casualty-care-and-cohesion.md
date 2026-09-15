# Casualty Care, Land Nav/Grid, MEDEVAC & Cross-Subject Cohesion

Written 2026-09-14, in response to a direct request to deepen medical/TCCC/
land-navigation/grid-plotting/9-line-MEDEVAC content into genuinely
"respected fields" people can turn to and brush up on, to build real
group/unit/team cohesion around that content (and every other subject in
the app), and to scope a doctrine-grounded catalog of team-building
exercises. Same standing rule as every other design doc in this folder:
**nothing below is implemented.** No function, seed field, or route named
here exists in `src/index.html` today unless a section explicitly says so.

Explored via a 4-candidate design workflow (Procedural-Drill-First,
Same-Rails Extension, Situated-Scenario-First/STX Lanes, Hub-and-
Certification-First), each independently designed against a direct
current-state audit, then adversarially scored and synthesized by a
separate judge pass. Every architectural claim below traces to that audit
— file:line references are real reads, not recollections. **Decisions
below are locked** (chosen by the user via multiple choice against the
judge's recommendations, all of which were accepted).

---

## 1. Confirmed current state (the audit, not assumption)

- **Medical (general)**: 11 doctrine entries (topics "Medical / First Aid",
  "Medical Readiness", "Army Medical System") + 35 board questions across 3
  categories. Real content, no dedicated route — scattered across generic
  Doctrine/Board-Drill browsing.
- **TCCC/TC3**: a live, unreconciled content bug. `doc-tccc` (ATP 4-02.11,
  `confidence:"in_transition"`) is the current, correct doctrine but has NO
  `keyPoints` array. `doc-tccc-1` (TC 4-02.1, `confidence:"verified"`, a
  redundant "M-MARCH" variant) cites a **superseded** publication yet reads
  as more trustworthy via its confidence tag. Plus 25 board questions.
  **Zero interactive content** — no MARCH-sequencing drill, nothing beyond
  static doctrine text + static Q&A.
- **Land Navigation**: `landNavDrill()` (`js/drills.js`, inside `#/drills`)
  has 3 real interactive modes — azimuth (back-azimuth math), pace (pace
  count × distance), grid (type back an 8-digit synthetic-MGRS string's 3
  components). No map, no click-to-place interaction anywhere in the app.
- **Grid plots / MGRS beyond Land Nav Drill's grid mode**: confirmed gap.
  Nothing else exists.
- **9-line MEDEVAC**: 5 board questions across 3 categories give the full
  breakdown as static text. **Zero doctrine entries** — no browsable
  doctrine card exists at all for this domain. Zero interactive drill.
- **Existing group/team infrastructure, all reusable**: Rapid Fire Team
  mode (single-device pass-around, works on every platform, has the just-
  shipped "steal" mechanic) and Study Rooms (real host-authoritative LAN
  networking, Android + Windows/Tauri only — no iOS/PWA/browser hosting)
  with two sub-modes, Rapid-Fire relay and Mock Board Live. All three draw
  from the same generic `board.questions` pool; none is subject-locked.
  Separately, `G.engine` already drives **182 shipped, branching training
  scenarios** (built for counseling practice) — proven production
  infrastructure this plan reuses rather than duplicates.
- Neither `ROADMAP.md` nor `content-education-roadmap.md` had any prior
  plan for any of this — confirmed net-new work, not a resumption.

---

## 2. Locked decisions

### 2a. Day-one fixes — ship immediately, standalone, ahead of everything else

Unanimous across all 4 design candidates, no reason to gate on any bigger
decision:

- Reconcile `doc-tccc` / `doc-tccc-1`: retire `doc-tccc-1` (or fold its
  useful content into `doc-tccc`), give `doc-tccc` a real `keyPoints`
  array, matching the rigor of the existing doctrine confidence-field
  backfill.
- Add the missing `doc-medevac-9line` doctrine entry (ATP 4-02.2) so the
  9-line has a real, browsable doctrine card for the first time.

### 2b. Content-domain build order — **TCCC-first**

Build the branching, consequence-based TCCC MARCH lane first. Every
candidate independently confirmed TCCC is the single biggest current gap
(zero interactive content today), and it's the right place to prove the
harder branching/consequence engine pattern before betting the 9-line
builder on it too.

**Concrete shape** (from the winning Situated-Scenario-First candidate,
extending `G.engine` rather than inventing a new content type): a `vitals`
status card that visibly worsens if an earlier MARCH letter is mishandled
— a Soldier discovers through consequence, not a warning label, that
hemorrhage control outranks airway management in real urgency. Some
scenarios' correct answer for a given letter is legitimately "none found,
continue" (per Procedural-Drill-First's refinement), so the drill tests
assessment judgment, not rote letter-recitation.

**Then, in order**: 9-line MEDEVAC builder (a fixed 9-node graph, each line
offering 3-4 plausible values including real wrong answers — a mislabeled
precedence code, wrong security state — sidestepping free-text grading
fragility; keep a wartime/peacetime branch on line 9 as a genuine
comprehension check, and a "Degraded-Comms" harder variant recognizing a
line's content without being told its number). Then Land Nav's 4th mode,
"plot" — a real SVG click-to-place grid (an 11×11 grid at 100m divisions,
`getScreenCTM().inverse()` for hit-testing, a tolerance radius with
miss-distance shown in meters, both read-it and plot-it directions) as a
straightforward new Land Nav Drill mode, not forced through a bigger
generalized engine — the judge was explicit this is the one place a
bigger abstraction would be over-engineering a simple widget. Medical
(general) gets a taxonomy/homing cleanup, not new interactivity — the
content is honestly declarative and already correctly served as doctrine
+ recall.

### 2c. Cross-subject cohesion mechanic — **Scenario Relay + Collective Decision**

Extend the existing 182-scenario `G.engine`, not a new content collection:

- **Collective Decision** (`discuss:true` node flag): the group debates
  aloud, a timer runs, one locked-in team answer gets submitted. The most
  doctrinally honest model of team cohesion — ADP 6-22/ADP 6-0's shared-
  understanding and mutual-trust framing describe a group reasoning
  together, not five people answering their own line in sequence. Because
  it's a node *flag*, it retrofits onto **all 182 existing scenarios plus
  every new TCCC/MEDEVAC lane, for free** — the strongest real answer to
  "generalizes across every subject."
- **Scenario Relay** (a lighter turn-rotation render mode): reuses Rapid
  Fire Team's existing pass-the-device handoff plumbing for the "each
  teammate supplies the next step" feel, without paying for a whole new
  content collection.
- **Sequencing, to de-risk the shared production engine**: ship the relay
  render mode and 1-2 STX lanes as a probe first, watch for regressions
  against the 182 existing scenarios, and only then layer in
  `discuss:true` and `vitals` as separate, sequenced changes — never as
  one bundled four-schema-concept change.
- **Independent, near-free win, ship any time**: widen Study Rooms' single
  category selector into a multi-category array (reusing the existing
  Custom Mix checkbox UI) so a host-configurable "Medical Night" or "TCCC +
  9-Line combined relay" deck works across solo play, local Team mode, and
  networked Study Rooms immediately — real cross-subject value on day one
  while the bigger scenario-engine bet is still being built.

### 2d. Leader-facing Squad Roster — **minimal version now**

A simple, manually-updated roster grid a leader ticks by hand (after
observing a Soldier, or after a completed round) — no auto-populate wiring
from live Study Rooms results yet. Cheap, honest, immediately useful;
defers the riskier cross-platform live-sync integration. Certification
tracks are a generic data shape (any content gets a badge by adding one
entry, no new UI per subject) — this is a genuinely different, additive
leader-visibility layer, not a competing cohesion mechanic.

### 2e. Team-building exercise catalog — **format-band phased rollout**

Ship in phases by format band, not all 10 at once and not just a 2-3-item
pilot:

**Phase 1 (config-only/icebreaker — ships alongside 2c's near-free win):**
1. **Contact Report Relay** — icebreaker, in-person circle, GUIDON as
   prompter only. A SALUTE/9-line scenario read aloud; going around the
   circle each person supplies exactly the next field. Doctrine: STP
   21-1-SMCT reporting formats + ATP 6-22.6 Army Team Building.
2. **Teach-Back Rounds** — leadership-development. Candidate seat rotates
   every round; an evaluator seat scores a peer against the real rubric —
   works across every subject in the app. Doctrine: FM 6-22 peer-coaching
   leader development.
3. **Cohesion Under the Clock: All-Domain Relay** — the proof-point
   exercise. Multiple squads run parallel relays on *different* assigned
   categories simultaneously (deliberately including subjects outside the
   5 named domains), live combined leaderboard. Doctrine: FM 6-22's
   shared-adversity cohesion principle, deliberately generalized.
4. **AAR Huddle** — the standard closer for every session in this catalog.
   GUIDON displays the four AAR prompts (planned/actual/why/sustain-
   improve) one at a time, keeping the group from jumping to complaints
   before establishing facts. Doctrine: the Army's standard AAR structure
   (needs a real title/paragraph re-verification before shipping as an
   in-app citation — flagged, not assumed).

**Phase 2 (high-stress/blind-trust — ships once Collective Decision + the
`discuss` mechanic land):**
5. **Blind Relay** — pairs, one describes a casualty situation or a
   land-nav grid target, the other (screen hidden) must build the 9-line
   or plot the coordinate from description alone. Doctrine: ATP 4-02.2 /
   TC 3-25.26 + FM 6-22's clear-communication-under-stress theme.
6. **Land Nav Pace-Trust** — pairs, live buddy-check of back-azimuth math
   before the pair moves — operationalizes the drill's own existing
   doctrinal warning that a simple math error sends a Soldier the wrong
   direction. Doctrine: TC 3-25.26 + AR 350-1 training-to-standard.
7. **MDMP Round-Robin** — exactly 7 people, each owns one MDMP step and
   must state what that step produces for a live, realistic mission — not
   the textbook definition. Doctrine: MDMP (ADP 5-0 lineage) + FM 6-22's
   rehearsal-based leader development.

**Phase 3 (content-dependent — ships once the TCCC lane and 9-line builder
from §2b exist):**
8. **Casualty Chain** — high-stress, physically active, needs real space.
   A line of stations physically moves a mock casualty; at each station
   the Soldier must correctly supply the next MARCH step out loud before
   the casualty advances. The standout entry across all four candidate
   lists. Doctrine: ATP 4-02.11 (Care Under Fire) + AR 350-1's hands-on-
   training emphasis.
9. **Degraded-Comms 9-Line** — the harder 9-line variant described in §2b,
   run as a group exercise. Doctrine: ATP 4-02.2 + ADP 6-0 disciplined
   initiative under degraded conditions.
10. **Squad TCCC Certification Night** — leader-facilitated, whole-squad.
    Rotating stations mix real app-graded drills with an honest manual
    checklist item for what the app genuinely cannot grade (a physical
    buddy-aid demonstration), closing with a group Mock Board Live or
    Rapid Fire Team round over TCCC content. Ties directly into §2d's
    Squad Roster. Doctrine: AR 350-1 leader-run certification + FM 6-22
    hands-on training.

---

## 3. Citation honesty — a real, named requirement, not a formality

Before any new content ships as an in-app `doctrine.entries` citation,
every pinpoint-specific reference surfaced during design needs a real
verification pass, not reuse of this document's citations as-is —
specifically the ATP 4-02.2 "Appendix C, Table C-1" quote and the TC
3-25.26 "paras 4-15/4-16" reference above, both stated with more
confidence during design than an unverified pass should carry, alongside
the AAR (commonly TC 25-20) and general AR 350-1/leadership references.
This is exactly the kind of drift that produced the live `doc-tccc`/
`doc-tccc-1` bug in the first place — the project's own recent 32-entry
doctrine confidence-field backfill (`GUIDON files/ROADMAP.md` §3d) is the
right model of rigor to apply to every new citation this initiative
introduces.

---

## 4. Open engineering risks, named rather than glossed over

- Free-text step grading is harder than a copy-paste of the existing loose
  keyword-match essay grading — needs real accept-list authoring per step
  or per line, or the drill will feel either unfairly strict or trivially
  gameable. The 9-line builder's fixed-graph-with-plausible-distractors
  design sidesteps this; a future free-text mode would need to solve it
  for real.
- Study Rooms' `room-schema.js` is a single, locked, cross-platform-pinned
  protocol shared by the host module, the Android native TLS plugin, the
  Tauri desktop build, and `dist/guest.html`, with `tools/test-room-core.mjs`
  pinning its allowlist. Any new mode/flag must ship on every platform
  together — this cannot land as web-only.
- Writing enough scenario variants (10-15+) per procedure to keep the
  TCCC/9-line drills from becoming rote memorization of a fixed answer key
  is a real content-authoring bottleneck, likely bigger than the engine
  code itself.
- Several catalog entries (Casualty Chain, Land Nav Pace-Trust) are
  physical/in-person facilitation exercises GUIDON can only support
  (timer, scenario text, scoring) rather than fully implement in software
  — their real quality can only be judged by someone actually running a
  session.
- Regression-testing the shared `G.engine` against all 182 already-shipped
  scenarios after adding `discuss`/`vitals` support is real, non-trivial
  work — hence the deliberate probe-first sequencing in §2c.
