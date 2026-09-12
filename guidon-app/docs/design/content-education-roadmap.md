# Content & Educational Materials Roadmap: PRT, Creeds & Branch Identities, Study Techniques, Search

Written 2026-09-10/11, in response to a direct request to turn Guidon into
a premier, searchable repository for Army foundational knowledge, doctrine,
and board-prep technique. Same standing rule as every other design doc in
this folder: **nothing below is implemented.** No route, seed key, store
accessor, or module named in this document exists in `src/index.html` or
`src/app-modules/` today unless a section explicitly says otherwise. This
document should get logged into `GUIDON files/ROADMAP.md` once its scope is
confirmed — a short pointer has been added there; this file is the detail.

Every architectural claim below was verified against the real repository
this session (grep hits and file:line references throughout) rather than
assumed from how a similar app might work. Six areas were independently
investigated before any of this was drafted: the content data model, the
global search engine, the SRS/study mechanics, the UI/routing/CSS-token
conventions, the existing creed/PRT content already shipping, and the MOI
Import/content-authoring pipeline. Where two of the four module drafts that
came out of that investigation disagreed with each other on a naming or
placement detail — this happened twice, both real, both reconciled below,
not papered over — the reconciliation is called out explicitly rather than
silently picking a winner.

---

## 1. CI/PR Status Summary

Confirmed before any of this was drafted, so the roadmap starts from a
known-good base:

- Local `main` was 12 commits behind `origin/main` (stale since 2026-09-08
  — a prior session's work had left it unsynced). Fast-forwarded cleanly
  (`6dacf4f` → `d7ddf75`), zero conflicts.
- **Zero open PRs.** The three PRs a prior audit flagged as broken are now
  resolved and merged: `#121` (windows-sys bump, a flaky `nav-tier2ab` CI
  job) landed via its dependabot branch; `#122` (a real webview2-com Rust
  compile error) was fixed for real via `#132`/`#133`/`#134` (version-skew
  fix, a Windows-smoke timeout increase, and a new dependabot ignore rule
  for the recurring webview2-com/windows-core pairing) and merged as
  `#124`/`#131`; `#120` (a `tauri-plugin-single-instance` merge conflict)
  was resolved via `#130`. Since then, `#135` (ESP32 flashcard firmware
  touch diagnostics) and `#136` (fixes for a resize-storm, board-card
  overflow, and a real narrow-width text-overflow bug on `#/train` and
  `#/transition`) also merged clean.
- CI on the current HEAD commit (`d7ddf75`): **success.** Desktop/iOS/
  Deploy workflows didn't re-run on that exact commit (it only touched
  `firmware/`, which is path-filtered out of those jobs), but both ran
  green on the immediately preceding app-touching merge (`#136`); the one
  `cancelled` iOS run visible in the Actions history is a benign
  concurrency-group supersession from the next push landing seconds later,
  not a failure.
- A leftover scratch file from an unrelated prior task
  (`guidon-app/_tablet-backup-scratch.mjs`) was found untracked in the
  working tree and has been deleted. Working tree is clean.
- **Known, pre-existing drift, unrelated to this task but worth flagging
  here since this document is meant to be logged into the same tracker**:
  `GUIDON files/ROADMAP.md` still says `Current version: v1.5.1` and its
  completed-initiatives table stops at round 8 (`#114`) — it was never
  updated through the v1.6.0 "What's New" feature, the v1.7.0 release
  (iOS PWA, install QR distribution), the ESP32 firmware fork, or `#120`
  through `#136`. Out of scope to backfill in full here; noted so a future
  session doesn't treat that table as current.

**Net: `main` is stable and green.** Everything below is new work proposed
on top of that base, not a response to any outstanding breakage.

---

## 2. Feature Architecture Breakdown

This section is the cross-cutting architecture — the shared data model and
search strategy every module section in Part 3 builds on. It's synthesized
from all four module drafts together, and it resolves two real
disagreements those drafts had with each other when each was written
without seeing the others (expected, since they were drafted in parallel —
this is exactly what a synthesis pass is for).

### 2.1 Why two new top-level `GUIDON_SEED` keys, not a fit into an existing one

`window.GUIDON_SEED` (`src/index.html:5930`, one line of inline JSON) has
17 top-level keys today (`doctrine`, `board`, `acronyms`, `mockboard`,
`resources`, `career`, …), each its own differently-shaped store with its
own generation pipeline and consumer view — there is no single universal
"content item" schema to slot new content into. Concretely:

- **Doctrine** (`doctrine.entries`) — tiered, citation-sourced,
  competency-tagged paraphrase cards: `{id, topic, title, body, tier,
  competency, source:{ref,para,asOf}}`.
- **Board questions** (`board.questions`) — recall-quiz cards:
  `{id, category, q, a, source, tier, concept, keyPoints, difficulty}`.
- **Terms** (`acronyms.terms`) — flat glossary pairs, no tier/citation:
  `{a, d, src}`, 3,623 entries.
- **Reference Library** (`src/app-modules/library.js`, *not* part of
  `GUIDON_SEED` at all) — full page-by-page text of 15 source PDFs,
  machine-generated by `tools/build-library-data.mjs`: `{id, citation,
  title, pdfAsset, pageCount, pages: [...]}`.

Neither PRT exercises nor creeds/branch mottos fit any of these without
distortion: PD content has a property none of the existing stores need to
represent — **fixed order within a named sequence** — and creed/motto
content spans a spectrum from formally-promulgated doctrine text
(Soldier's/NCO/Ranger creeds) to unit-tradition text with no numbered
publication behind it at all (a distinction none of the existing `source`
shapes capture). Both therefore get their own new top-level key, following
the same "closest existing analog by shape is `doctrine.entries`" pattern
used everywhere else in this codebase when a new content family shows up.

### 2.2 The reading pillar vs. the quiz/recitation pillar — how `creeds` and `board.questions` coexist

The existing-content audit confirmed the Soldier's Creed, NCO Creed, and
Ranger Creed **already exist, verbatim**, today — but as `board.questions`
rows under `category: "Creeds"` (ids `creed-4` through `creed-10`
and neighbors, 20 entries total), shaped for Board Drill/Rapid Fire
recall-quiz consumption (`q`/`a`/`keyPoints`/`difficulty`), not for
browsing. There is no page anywhere in the app today where a Soldier can
just *read* the full Soldier's Creed, its history, and what the Warrior
Ethos actually is, organized alongside the NCO Creed and every branch's
motto — the way `#/doctrine` lets someone browse paraphrase cards.

The two module drafts covering this content (§3.2 Creeds, §3.3 Study
Techniques) each proposed a real, independently-justified piece of schema
against this same content family without seeing each other's proposal.
Read together, they compose cleanly into one architecture rather than
conflicting, and this is the reconciliation:

- **`GUIDON_SEED.creeds`** (new, §3.2) is the **reading/reference pillar**
  — full text, history, core tenets, branch grouping, organized for
  browsing. For the three creeds that already exist as verbatim
  `board.questions` rows, the new `creeds` entry carries a `linkedBoardId`
  field pointing back at the existing row and does **not** retype the
  verbatim text a second time (`tools/find-content-redundancy.mjs`, which
  already exists in this repo to catch exactly this class of drift, is the
  right tool to gate this at authoring time). Only genuinely new content —
  every branch motto, Cadet Creed, Army Aviator/Night Stalker/Combat Medic
  — gets a fresh `id` with no linked source.
- **`board.questions` rows under `category: "Creeds"`** stay exactly where
  they are and keep doing exactly what they do today (Board Drill, Rapid
  Fire, SRS scheduling via `G.board.noteExternalResult`) — this roadmap
  does not touch, delete, or duplicate them. They gain one new, additive,
  optional field, `lines` (§3.3) — an array of stanza-boundary strings —
  because chunking and backwards-chaining need real line/stanza
  boundaries, which the existing single-string `.a` field can't provide.
  `lines` is read by nothing else and breaks nothing existing.

So: **reading and browsing** happens on the new `#/creeds` route against
`GUIDON_SEED.creeds`; **quizzing and recitation practice** happens on the
existing Board Drill / Rapid Fire surfaces (and the new `#/recite` route,
§3.3) against the existing `board.questions` rows, now with `lines`
populated. A "Read the full creed" action on a quiz card and a "Recite
this" / "Quiz me" action on a reading-pillar card are the two cross-links
that make this feel like one coherent feature rather than two unrelated
ones — both reuse `G.nav.seed(target, id)`, the same one-shot handoff
mechanism Global Search already uses today (`src/index.html:33071-33078`).

### 2.3 Unified schema reference

**`GUIDON_SEED.creeds[]`** — new top-level key, siblings of `doctrine`:

```json
{
  "id": "creed-engineer",
  "kind": "motto",
  "group": "Maneuver & Combat Arms",
  "branch": "Engineer",
  "scope": "branch",
  "officialTitle": "U.S. Army Engineer Regiment Motto",
  "motto": { "text": "Essayons", "language": "French", "translation": "Let us try" },
  "fullText": "",
  "history": "<from the branch's official heraldry record>",
  "coreTenets": ["<from the same official source>"],
  "source": { "ref": "The Institute of Heraldry — U.S. Army Engineer Regiment insignia", "para": "", "asOf": "", "status": "official-heraldry" },
  "tier": "all",
  "tags": ["essayons", "engineer", "sapper", "branch-motto"],
  "linkedBoardId": null
}
```

```json
{
  "id": "creed-soldiers",
  "kind": "creed",
  "group": "Leadership & General Service",
  "branch": "Army-wide",
  "scope": "army-wide",
  "officialTitle": "The Soldier's Creed",
  "fullText": "",
  "history": "<promulgation/adoption background>",
  "coreTenets": ["Warrior Ethos (the middle four lines)", "Army Values", "Never accept defeat / never quit / never leave a fallen comrade"],
  "source": { "ref": "U.S. Army / TRADOC", "para": "", "asOf": "", "status": "doctrine" },
  "tier": "all",
  "tags": ["soldiers-creed", "warrior-ethos"],
  "linkedBoardId": "creed-5"
}
```

Field notes:

- **`kind: "creed" | "motto"`** — full recited pledges (Leadership &
  General Service) vs. short branch mottos with no recited-pledge text
  (most Maneuver/Sustainment branches, per the audit — see §3.2's
  reconciliation table). A `kind: "motto"` record leaves `fullText` empty
  and carries its substance in `motto` + `history` + `coreTenets` instead,
  rather than inventing a full "creed" where the audit found none exists.
- **`source.status`** — `"doctrine"` (formally promulgated in a numbered
  Army publication — Soldier's/NCO/Ranger creeds already qualify, via TC
  7-22.7 and TC 3-21.76), `"official-heraldry"` (adopted branch mottos,
  authoritatively sourced from The Institute of Heraldry), or
  `"unit-tradition"` (real, organizationally-used, but not found in any
  numbered publication this project has access to — Cadet Creed, Army
  Aviator, Night Stalker, Combat Medic). This field is the load-bearing
  addition: it's what stops the app from silently implying a doctrinal
  status a piece of content doesn't have, matching this project's
  documented history (`GUIDON files/ROADMAP.md` §1) of catching and
  reverting fabricated or unverifiable doctrine claims.
- **`group`** — one of the task's own four category names verbatim
  (`Leadership & General Service`, `Maneuver & Combat Arms`,
  `Sustainment, Logistics & Support`, `Aviation & Special Operations`), so
  the page's top-level grouping needs no separate lookup table.
- **`linkedBoardId`** — set only for the three creeds that already exist
  in `board.questions`; `null` for everything genuinely new.
- **`tier`** — follows `doctrine.entries`' convention (`"all"`, a single
  `"E#"`, or a hyphen range expanded by `util.expandTierTokens`,
  `src/index.html:6447-6459`), but whether tier-scoping is even meaningful
  here is an open question (§5) — the Soldier's Creed isn't rank-gated
  knowledge the way a leadership doctrine card is.

**`GUIDON_SEED.prt.drills[]`** — new top-level key:

```json
{
  "id": "pd",
  "name": "Preparation Drill",
  "abbr": "PD",
  "purpose": "Warm-up drill performed before conditioning activities.",
  "cadence": { "slow": 50, "moderate": 80, "unit": "counts/min" },
  "repRule": {
    "standalone": 10,
    "combinedSameSession": 5,
    "note": "No more than 10 repetitions of any single 4-count exercise; reduced to 5 repetitions per exercise on a day PD is combined with a stability or conditioning drill in the same session.",
    "source": { "ref": "FM 7-22", "para": "TBD-verify", "asOf": "2020-10-01 (incl. C2)" }
  },
  "exercises": []
}
```

`PrtExercise` record shape (populates `drills[].exercises`):

```json
{
  "id": "pd-ex-01",
  "drillId": "pd",
  "order": 1,
  "name": "Bend and Reach",
  "counts": 4,
  "repRuleOverride": null,
  "startingPosition": null,
  "movementDescription": null,
  "sourceStatus": "pending-source",
  "source": { "ref": "ATP 7-22.02", "para": null, "asOf": null }
}
```

- **`order`** (1–10, unique per `drillId`) is load-bearing doctrine, not
  just a UI sort key — FM 7-22 states PD "is always performed in this
  fixed order."
- **`startingPosition` / `movementDescription` / `source.para` /
  `source.asOf`** stay `null` and `sourceStatus` stays `"pending-source"`
  until ATP 7-22.02 is acquired and transcribed (§2.4 — this is a real,
  confirmed blocker, not a formality).
- **`repRuleOverride`** stays `null` for all current entries; exists only
  so a future correction doesn't require a schema change.
- **No `tier` field** — per the same precedent Dictionary and the
  Reference Library already establish (no tier field, and the codebase
  treats that as correct, not incomplete): every Soldier performs the same
  PD sequence regardless of grade, so a `tier` field would always evaluate
  to "show everyone" and add nothing.
- `prt.drills[]` is an array specifically so Recovery Drill and
  Conditioning Drills 1/2 slot in later as additional entries with **zero
  schema change** (§3.1 §7) — each is doctrinally the same shape as PD.

**`board.questions` — additive field only:**

```json
{
  "id": "creed-4",
  "lines": [
    "No one is more professional than I.",
    "I am a Noncommissioned Officer, a leader of Soldiers.",
    "..."
  ]
}
```
(all other fields on this row are unchanged; `lines` is new, optional, and
read by nothing existing.)

### 2.4 The one real content-sourcing blocker: ATP 7-22.02

`guidon-app/docs-source/` already holds 15 official Army PDFs with
pre-extracted plain text (`docs-source/_text/*.txt`) — a real, existing
corpus, not something to build. `FM_7-22_Holistic_Health_and_Fitness.txt`
(FM 7-22, incl. C2, 1 Oct 2020) is among them and directly confirms, safe
to cite verbatim today:

- PD cadence: a controlled **slow cadence of 50 counts per minute or a
  moderate cadence of 80 counts per minute**.
- Rep rule: **no more than 10 repetitions of any single 4-count exercise**,
  reduced to **5 repetitions per exercise** on a day PD is combined with a
  stability or conditioning drill in the same session.

But FM 7-22 itself explicitly defers the actual exercise-by-exercise
detail: *"See ATP 7-22.02 for exercise modifications for Preparation Drill
and Conditioning Drill 1."* **ATP 7-22.02 (Physical Readiness Training) —
the manual with each exercise's starting position and movement
description — is confirmed absent from `docs-source/` today.** This is a
concrete, checked fact (only ADP 5-0/6-0/6-22/7-0, AR 350-1/600-20/
600-8-19/600-9/623-3/670-1, ATP 6-22.1, DA PAM 600-25, FM 7-22, TC
3-21.5/3-22.9 are present), not a guess.

**This is a real prerequisite, not a formality**: this project has a
documented history (`GUIDON files/ROADMAP.md` §1) of catching and
reverting fabricated doctrine content, and the same discipline applies
here. No `PrtExercise.startingPosition`/`.movementDescription` should ship
with plausible-sounding text reconstructed from general PT knowledge. The
concrete unblock path: add the ATP 7-22.02 PDF to `docs-source/`, run
`tools/build-library-data.mjs` (this alone also unblocks the Reference
Library — full ATP 7-22.02 text becomes readable under `#/library`
immediately, independent of any PRT-module work), then hand-transcribe
each exercise's starting position and movement description into the
`PrtExercise` records via `tools/seed-io.mjs`. A new lint gate,
`tools/lint-prt-sources.mjs` (mirroring the existing small standalone gate
scripts like `lint-capacitor-config.mjs`), should fail CI if any
`PrtExercise` ships with `sourceStatus !== "verified"` and a non-null
`startingPosition` — cheap insurance against a half-populated record
silently going out looking authoritative.

By contrast, **every item in the Creeds module is short, standard, and
already public** — no PDF acquisition blocks that work. See §3.2 §4 for
the concrete source-per-item plan (TIOH for branch mottos, USASOC/MEDCoE/
Cadet Command for unit-tradition entries, `ADP_6-22` — already present in
`docs-source/` — for Army Values/LDRSHIP).

### 2.5 Search-indexing strategy

Global Search (`views.search`, `src/index.html:32627`) has no separate
index structure to replace — `runSearch(q)` (32794) pulls per-record from
`store.*` accessors and memoizes a lowercased `_hay` string directly on
each record the first time a search touches it (the caching pattern at
32851-32856, added in an earlier perf pass). Six types are wired today via
`TYPES` (32642) / `SECTION_ORDER` (33021): `scenario`, `board`, `doctrine`,
`lesson`, `resource`, `career`. Adding two more is the same shape of
change made six times already:

1. **New store accessors** `store.creeds()` and `store.prt()`, same
   signature and per-accessor memoization convention as `store.doctrine()`,
   including the repeated tier-filter predicate + `util.expandTierTokens()`
   pattern (though see §2.3 — `prt` entries carry no `tier` field, so
   `store.prt()`'s filter is a no-op by construction, not a special case).
2. **Two new `_hay` builders**, matching the real field names from §2.3
   (corrected here from an earlier draft pass that referenced field names
   the schema doesn't actually have):
   ```js
   // creeds — fields per §2.3's actual GUIDON_SEED.creeds shape
   if (c._hay === undefined) {
     c._hay = ((c.officialTitle||"")+" "+(c.branch||"")+" "+(c.group||"")+" "+
       (c.motto&&c.motto.text||"")+" "+(c.fullText||"")+" "+(c.history||"")+" "+
       (Array.isArray(c.tier)?c.tier.join(" "):(c.tier||""))+" "+
       ((c.source&&c.source.ref)||"")+" "+(c.tags||[]).join(" ")).toLowerCase();
   }
   // prt — fields per §2.3's actual PrtExercise shape
   if (p._hay === undefined) {
     p._hay = ((p.name||"")+" "+(p.movementDescription||"")+" "+
       ((p.source&&p.source.ref)||"")).toLowerCase();
   }
   ```
   Matching stays plain case-insensitive substring (`s._hay.includes(ql)`)
   — no fuzzy matching or tokenization is introduced anywhere in this
   codebase's search today, and adding it for only two of eight types
   would make Global Search behave inconsistently type-to-type.
3. **Two new `SECTION_ORDER` entries** and two new `goTo()` branches
   (33078): `if (type === "creed") location.hash = "#/creeds";` /
   `if (type === "prt") location.hash = "#/prt";`. Neither needs a
   `G.nav.seed()` deep-link to ship — board and lesson hits already
   navigate to their section route today without seeding a specific entry,
   so creeds/PRT can start the same way; adding entry-level deep-linking
   later is a follow-on, not a blocker.
4. **Neither `#/creeds` nor `#/prt` goes into `UNINDEXED_DOMAIN_HASHES`**
   (32792) — that list exists specifically for domains Global Search does
   *not* yet cover (Forms, Counseling, IDP, Writing, Money, Health,
   Transition); these two are indexed from day one.
5. A short-form abbreviation like "PD" is exactly the flat `{a, d, src}`
   shape Dictionary/Terms already holds 3,623 of — adding one entry there
   (`{"a":"PD","d":"Preparation Drill","src":"..."}`) is a one-line,
   independent addition that makes "PD" resolvable from Dictionary's own
   in-view search too, separate from the Global Search change above.

### 2.6 Hierarchical nav placement

`ROUTES` (`src/index.html:33143-33219`) is a flat `{hash, label, ico,
render}` array; `NAV_GROUPS` (33243-33289) groups routes by hash for
display only — adding a section means adding to both, no new nav
machinery. Standardizing on one nav order across what the module drafts
proposed independently: the existing `"prep"` group already splits at a
`subdivideAfter` marker into a "do the work" cluster (`#/train`, `#/board`,
`#/group`, `#/records`, `#/calendar`) and a "reference material" cluster
(`#/doctrine`, `#/dictionary`, `#/library`, `#/moi`). Creeds, PRT, and
Recitation are reference material in the same sense Doctrine is —
tiered/citable, browsable content — so all three land in that second
cluster, immediately after Doctrine (not at the end, and not as a new
top-level accordion group — two or three routes is too thin to justify a
seventh section, and it would fragment a grouping that's already
coherent):

```js
{ id: "prep", label: "Board Prep",
  hashes: ["#/train", "#/board", "#/group", "#/records", "#/calendar",
           "#/doctrine", "#/creeds", "#/prt", "#/recite",
           "#/dictionary", "#/library", "#/moi"],
  subdivideAfter: "#/calendar" },
```

Nav labels, standardized to the task's own phrasing: `"Creeds & Branch
Identities"` (not the shorter "Creeds & Branch Identity" a draft-stage
pass used), `"Physical Readiness"`, `"Recitation Drill"`.

### 2.7 Open implementation decision: separate app-modules, or inline `views.*`?

Two of the four module drafts (PRT, Creeds) independently proposed
separate files — `src/app-modules/prt.js` and `src/app-modules/creeds.js`
— following the `moi-import.js` precedent, reasoning that both will grow
(PRT needs a multi-drill picker once RD/CD1/CD2 land; Creeds needs
group/branch filtering state). The Search/UX draft independently proposed
inline `views.creeds`/`views.prt` functions instead, following the
`views.doctrine` precedent, reasoning that neither is yet as complex as
MOI Import's citation-matching logic was when it earned its own file.

Both patterns are real and already shipped in this codebase (`#/moi` as a
separate module; `#/doctrine` inline) — this is a genuine, small
implementation judgment call, not a technical constraint, and it's named
here rather than decided silently. Recommendation, offered not imposed:
start inline (`views.creeds`, `views.prt`), since v1 of both is a
`.list-detail` index+detail page with no state more complex than a filter
chip and a search box — the same shape `views.doctrine` already is — and
graduate to a separate module only if/when the RD/CD1/CD2 drill-picker
(§3.1 §7) actually lands and needs it.

---

## 3. Module Specifications

### 3.1 Physical Readiness Training Module (FM 7-22 / ATP 7-22.02)

*(Schema, sourcing blocker, and search-indexing details for this module
are covered in §2 above and not repeated here; this subsection covers the
route, UI, and study-mode integration.)*

**What already exists vs. what's proposed**: the creed/PRT content audit
found the Preparation Drill already fully present as prose in
`window.GUIDON_SEED` (`src/index.html:5930`) — the fixed 10-exercise order
and cadence/rep notes are there in text form — but there is no PD
*feature*: no dedicated route, no per-exercise data records, no
sequence-drill UI. This section proposes that feature.

**Route**: `#/prt`, added to `ROUTES` and the `"prep"` `NAV_GROUPS` cluster
per §2.6. Layout reuses `.list-detail`/`.list-detail-list`
(`src/index.html:5584-5598`) exactly as `views.doctrine` does — the CSS
component's own header comment already names Board Drill/Doctrine/Squad
Roster as consumers of a plain two-pane index+detail section. List pane:
the 10 PD exercises in fixed `order`, numbered. Detail pane: name, 4-count
structure, cadence (both 50 and 80 shown, matching FM 7-22's own "a slow
cadence... or a moderate cadence" presentation), rep rule (the
combined-session 5-rep note surfaced explicitly, not buried), starting
position/movement description — or a plainly-labeled "reference pending"
state while `sourceStatus` is `"pending-source"`, never rendered as if it
were populated — and the `source` citation line in the same style Doctrine
already renders its own `source.ref`/`source.para`.

**"Run the drill" mode** reuses the Rapid Fire timer's real, already-proven
tick/pause/`visibilitychange` plumbing (`renderRapidFire`,
`src/index.html:13095+`, specifically `tick()`/`onVisible()` at
13378-13391) rather than writing a third independent timer implementation
(Mock Board already has its own second one) — advancing through the 10
exercises at the selected cadence, pausing automatically on
`visibilitychange`. This is presentation-only, not a Rapid Fire
`beginRound()` integration, since PD isn't a graded quiz pool. Note: the
existing timer format is seconds-only (`"Ns"`), and a multi-exercise
runthrough (10 exercises × up to 10 reps at 50-80 counts/min) will run
past a minute — this is the first consumer needing an `mm:ss` display, a
small scoped addition to the shared timer formatting (see also §3.3's
identical need — one `fmtClock()` helper serves both).

**"Quiz me on the order" mode** hooks straight into the existing SRS with
zero new plumbing: `G.board.noteExternalResult(id, gradeLevel)`
(`src/index.html:13891`) already accepts any id + a 0-3 grade and
schedules it in the same `kv`/`srs:<id>` system Board Drill uses. Each
`PrtExercise.id` (`pd-ex-01`…`pd-ex-10`) is a ready-made SRS key for a
"what's next after Rower?" recall prompt, spaced and reviewed the same way
board questions are.

**§7. Architectural hooks: RD, CD1/CD2, and ACFT — sized, not specced.**
`prt.drills[]` is deliberately an array, not a single `pd` object,
specifically so Recovery Drill and Conditioning Drills 1/2 slot in later
as additional entries with **zero schema change** — each is doctrinally
the same shape as PD (a named, ordered, cadence-and-rep-governed sequence
of exercises), so they reuse `PrtExercise` verbatim (new `drillId` values,
new `order` sequences, their own drill-level `cadence`/`repRule`). The
Hub's list-detail rendering already reads `drills[]` generically, so a
drill picker (chips: PD / RD / CD1 / CD2, the same `.chip` component used
elsewhere) is the only new UI surface needed. Sourcing for RD and CD1/CD2
is blocked on the identical ATP 7-22.02 prerequisite as PD — FM 7-22's own
cross-reference names it for CD1's modifications too, so acquiring that
one PDF unblocks all three drills at once.

ACFT prep is a **different, larger data shape**, called out only as a
placement decision here, not a schema: the six ACFT events are scored
against age/gender standards tables, not performed as a fixed 4-count
cadence sequence — a `PrtExercise`-shaped record is the wrong fit. Proposed
only as `prt.acft` sitting alongside `prt.drills` in the same top-level
seed key, reusing the Hub's route/nav/citation-placeholder conventions but
not its per-exercise record shape, with its own schema design pass
deferred until scheduled. **Unverified this session, flagged rather than
assumed**: whether ACFT scoring standards are already present in FM 7-22
(later editions are known to have carried ACFT content) or need their own
new source document — a prerequisite check separate from the PD/RD/CD
blocker above.

**Residual risks**: `repRule` is FM 7-22's general, drill-level statement
— nothing confirms yet whether ATP 7-22.02 carries a per-exercise
exception, which is exactly why `repRuleOverride` exists as a slot rather
than being asserted false. The proposed `tools/lint-prt-sources.mjs` gate
doesn't exist yet and should ship alongside the first `PrtExercise` record
that carries real transcribed text, not after.

### 3.2 Comprehensive Creeds & Branch Identities

**Framing**: this is a new content pillar, not new plumbing — it reuses a
tiered/citable content shape, the existing two-pane index+detail page
pattern, and the existing declarative nav wiring wholesale (all covered in
§2). What's actually new is the content itself, most of which does not
exist in this app today.

**Reconciled against the audit, item by item:**

| Requested item | Status | Existing id(s) / evidence | Disposition |
|---|---|---|---|
| Soldier's Creed (+ Warrior Ethos) | **EXISTS**, verbatim | `creed-5` (full text), `soldiers-creed` (paraphrase) | Re-home via `linkedBoardId`; don't re-author |
| NCO Creed | **EXISTS**, verbatim | `creed-4`, `creed-6`, sourced TC 7-22.7 | Re-home |
| Ranger Creed (75th Ranger Regiment) | **EXISTS**, verbatim | `creed-7`, sourced TC 3-21.76 | Re-home |
| Army Values / LDRSHIP | **EXISTS** | id `army-values` | Re-home |
| Cadet Creed | **DOES NOT EXIST** | zero matches | New — see open question below on fit |
| Infantry, Armor & Cavalry, Field Artillery, Engineer ("Essayons") | **DOES NOT EXIST** as creed/motto | only MOS/CMF/school data; zero matches for "Essayons" | New |
| Ordnance, Quartermaster, Transportation, Signal Corps, Military Police | **DOES NOT EXIST** | only branch/MOS/proponent-school references | New |
| Army Aviator | **DOES NOT EXIST** | zero matches | New |
| Special Forces ("De Oppresso Liber") | **DOES NOT EXIST** | zero matches for the motto; "Special Forces" hits are MOS/CMF/SFAS only | New |
| Night Stalker (160th SOAR) | **DOES NOT EXIST** | "160th" appears once, as a bonus/retention note, no creed text | New |
| Combat Medic | **DOES NOT EXIST** | "Combat Medic" appears only as an MOS/role (68W) description | New |

**No branch-creed/motto category exists in the data model at all today.**
Combat-arms and sustainment branches appear only as MOS/CMF career data.
Building this content is net-new work for 11 of the 15 requested
identities — roughly 6 of 10 audited items exist in some form (several as
full verbatim text), but the single biggest gap is **branch identity
content as a whole.**

**Sourcing plan, by tier of authority** (see §2.4 for why this is
materially easier than the PRT sourcing situation — nothing here is
blocked on acquiring a new PDF):

- **`status: "doctrine"`** — Soldier's/NCO/Ranger creeds keep their
  existing citations (TC 7-22.7, TC 3-21.76). Army Values/LDRSHIP has an
  even stronger local option: `ADP_6-22` is already present in
  `docs-source/` — full LDRSHIP text pulls directly from a file already
  in this repo.
- **`status: "official-heraldry"`** — for every combat-arms/sustainment
  branch motto, **The Institute of Heraldry (TIOH)** is the correct single
  authority: the Army's official heraldic office, publishing each branch's
  adopted motto, translation, and adoption history. **Do not transcribe
  branch mottos from memory when authoring** — "Essayons" and "De Oppresso
  Liber" are given directly by the task and safe to use as-is, but every
  other branch's exact wording/translation/adoption year should be pulled
  verbatim from TIOH at authoring time.
- **`status: "unit-tradition"`** — Special Forces' creed and USASOC's own
  history office; the 160th SOAR "Night Stalker" creed and the regiment's
  own public affairs materials (flagged unit-tradition because, unlike the
  Ranger Creed, it isn't in any numbered pub this project has found);
  Combat Medic's creed via MEDCoE or unit tradition; Army Aviator via the
  Army Aviation Center of Excellence (flagged unit-tradition because,
  unlike Soldier's/NCO/Ranger, there's no evidence of one formally
  promulgated creed).
- **Cadet Creed** — U.S. Army Cadet Command, flagged unit-tradition/
  organizational (see open question below on whether it even fits this
  app's audience).
- Installation names attached to branch schools have changed more than
  once recently — `source.ref` should name the organization ("U.S. Army
  Engineer School," "The Institute of Heraldry," "USASOC"), not a fort
  name, and let the authoring pass fill in the current installation/URL at
  write time rather than freezing a detail into this document that will
  outlive it.

**Authoring sequence, cheapest/highest-confidence first**: (1) re-home the
three existing verbatim creeds + `army-values` — no new research, just
restructuring already-verified text; (2) the four Maneuver & Combat Arms
mottos (Essayons and De Oppresso Liber's wording already given, though SF
files under Aviation & Special Ops not this group; Infantry/Armor & Cav/
Field Artillery each need one TIOH lookup); (3) the five Sustainment/
Logistics mottos (same TIOH-lookup pattern, no existing hook to build
from); (4) the five Aviation & SOF entries (mixed sourcing tiers; Combat
Medic and Night Stalker are the least-documented and should carry the
clearest disclaimer); (5) Cadet Creed last — lowest audience overlap, and
the one item where "does this belong in Guidon" is worth settling before
writing it.

**Study-mechanics reuse (optional, phase 2 — not required to ship
reading/indexing)**: `G.board.noteExternalResult(id, gradeLevel)` could
back a self-graded "Recitation Check" directly against a creed's own id,
and `G.board.rapidFireEngine`'s proven timer could back a timed-recitation
mode — both already-shipped extension points, detailed fully in §3.3
which owns this ground.

### 3.3 Board Study Techniques & Interactive Tools

**Framing**: every mechanism this section needs a home for already exists
in a recognizable form — per-item spaced review (`kv` records keyed
`"srs:"+id`, `schedule()`, `saveSrs()` — `src/index.html:9243-9313`), a
fire-and-forget "grade this id" hook any feature can call without going
through Board Drill's own UI (`G.board.noteExternalResult`, 13891), a
proven round-timer with pause-on-background handling (Rapid Fire,
13110-13403, and an independent second copy in Mock Board, ~11930-11987),
the shared `.list-detail` CSS pattern, and the declarative `ROUTES`/
`NAV_GROUPS` wiring. This section needs one new app surface plus a small
number of well-scoped additive fields — not a new content-family type the
way MOI Import or the Reference Library needed.

**Route**: `#/recite`, a new `G.recitation.render(mount)` module
(placement per §2.7's open decision), added to the `"prep"` `NAV_GROUPS`
cluster per §2.6. Builds the same list+detail shape as `views.doctrine`.
The index pane lists every `board.questions` row with `category:
"Creeds"`, plus any `doctrine.entries` row explicitly flagged recitable
(§4 below). Entry points reuse `G.nav.seed("recite", id)` — the same
one-shot handoff mechanism Global Search already uses — so a "Recite this"
button on a Creeds-category card or a reading-pillar card (§2.2) can hand
off directly. Search and filtering fall out for free: Creeds already index
as type `"board"` in Global Search today, and any new recitable doctrine
content indexes as type `"doctrine"` automatically — nothing in
`views.search` needs to change to make this content findable.

**1. First-Letter Mnemonics — thin wrapper, zero schema change.** A pure
display transform over text the seed already has (`.a`, or `.lines`
line-by-line for a per-stanza prompt). One pure function alongside
`util.expandTierTokens` (`src/index.html:6447-6459`, the existing home for
small text-shaping helpers):

```js
util.firstLetterPrompt = function (text) {
  return text.replace(/\b([A-Za-z])[A-Za-z']*\b/g, "$1");
};
```

The detail pane renders a "Full text" / "First letters" toggle swapping
the displayed string through this function — "I am an American Soldier..."
becomes "I a a A S...". Works today on every existing Creeds entry with no
seed edit at all; no `kv` record, no SRS interaction, no new route.

**2. Chunking & Backwards Chaining — new per-item progress state, with a
thin hook back into SRS.** The existing SRS record (`{reps, ease,
interval, due, misses, lastGrade}`) tracks whole-item review scheduling,
not sub-item chunk progress. New sibling key family, same convention as
`srsKey`:

```js
function reciteKey(id) { return "recite:" + id; }
async function loadRecite(id) {
  const r = await db.get("kv", reciteKey(id));
  const v = r && r.v;
  return (v && typeof v === "object") ? v
    : { chunksLearned: [], direction: "forward", lastChunkIdx: -1 };
}
async function saveRecite(id, s) { await db.put("kv", { k: reciteKey(id), v: s }); }
```

`direction: "forward"` walks `lines[0..n]` revealing one stanza at a time;
`"backward"` is the identical UI walking `lines[n..0]` — backwards
chaining needs no separate code path, only a reversed index into the same
array. Once `chunksLearned.length === lines.length`, completion calls
`G.board.noteExternalResult(id, gradeLevel)` directly, using the same
4-level grade control Board Drill already renders — the whole creed
graduates into the real spaced-review queue with no second scheduling
algorithm. Chunk-level state is new; whole-item scheduling is not.

**3. Physical & Stress Integration — reuse the timer plumbing, not the
round-draw engine.** The tick/pause/`visibilitychange` pattern already
exists twice, independently (Rapid Fire and Mock Board) — a recitation
timer should not become a third copy. Factor it once as a shared
`util.makeRoundTimer(cfg)` returning `{start, pause, resume, onTick}`, with
both existing call sites and the new recitation mode using it. The one
real gap: both existing implementations format seconds-only, fine for a
30-90 second board-question round but wrong for a 2-3 minute creed
recitation — add a small `fmtClock(sec)` (`m+":"+String(s).padStart(2,"0")`)
for display (this is the same `mm:ss` need PRT's "Run the drill" mode has
— one helper serves both, per §3.1).

**Deliberately not reused**: `G.board.rapidFireEngine`'s `beginRound(pool,
mode, opts)` is built around drawing many short, independent items one at
a time from a pool — right for a round of board questions, a poor fit for
timing one continuous multi-minute recitation of a single item.
Recitation should reuse the *timer helper* the round engine is built on,
not the round-draw session shape — forcing one long text through a
many-short-cards abstraction would fight the engine rather than use it.

**Audio prompts — genuinely new.** Nothing resembling text-to-speech or
audio cueing exists anywhere in the app today. Add `G.caps.speechSynthesis`
following this codebase's existing non-destructive, existence-only
capability-probe convention (`typeof window.speechSynthesis !==
"undefined"`) — an audio-prompt toggle appears only when the probe passes
and degrades silently to a visual-only pulse cue otherwise, matching this
project's general "never fail the feature, just narrow it" posture toward
optional device capabilities. Two concrete uses: reading a stanza's
first-letter prompt aloud for eyes-off practice, and a metronome-style
count cue at a fixed BPM for reciting while doing Preparation Drill — and
here the doctrine is already sourced (§2.4): FM 7-22's real 50/80
counts-per-minute cadence values, not an invented number.

**Exertion simulation — scoped to UI, not sensors, on purpose.** No
accelerometer, heart-rate, or wearable integration is proposed. "Stress"
means a shortened timer window, an optional background-noise audio track,
and a pre-round checklist reminder ("stand at attention, recite before you
sit") — all UI/copy, matching this app's existing pattern of not
requesting a device capability (camera, microphone, motion sensors) it
doesn't strictly need. This is a deliberate scope boundary, named here the
same way this project names other declined-capability decisions rather
than adding them quietly later.

**4. Cadence & Projection Guidance — mostly new doctrine content, a small
new pre-round checklist.** Board-room posture/etiquette (position of
attention, at ease, reporting statement, customs and courtesies) belongs
in Doctrine, not a bespoke content type: author it as new `doctrine.entries`
rows sourced from `docs-source/_text/TC_3-21.5_Drill_and_Ceremonies.txt`
(already present), same shape every other doctrine card uses. This reuses
the existing `#/doctrine` route, its search box, its topic chips, and
Global Search's existing `"doctrine"` type — no new content family, no new
render path. The exact wording must be pulled verbatim from that source
file during authoring, consistent with this project's rule against
inventing claims it can't verify against a real source.

The interactive part is small and new: a checklist panel shown before a
timed recitation round starts (position of attention / at ease / eye
contact / do not shout), plain checkboxes, optionally a single `kv` flag
so it doesn't need re-showing every round. **Voice projection is guidance
text only, never a measured feature** — no microphone-capture is proposed
here; an actual loudness-measuring feature would need microphone
permission for a cosmetic coaching cue, which this project has already
shown a pattern of declining when the permission cost outweighs the value
(the same reasoning behind declining camera-based QR scanning elsewhere in
this app's history).

**Reuse summary:**

| Feature | Reuses (named) | Genuinely new |
|---|---|---|
| First-Letter Mnemonics | `.a`/`.lines` text as-is; new `util.firstLetterPrompt` (pure fn) | A display toggle only — nothing stateful |
| Chunking / Backwards Chaining | `G.board.noteExternalResult` + `schedule()`/`saveSrs` for the graduation step; existing 4-level grade control UI | `lines` seed field; new `"recite:"+id` kv record (`chunksLearned`, `direction`) |
| Timed recitation | Rapid Fire/Mock Board tick-pause-visibilitychange pattern (promoted to one shared `util.makeRoundTimer`) | `mm:ss` formatting (existing timers are seconds-only); the round-draw engine is deliberately *not* reused |
| Audio prompts / cadence cue | `G.caps`-style capability-probe convention; FM 7-22's real 50/80 counts-per-minute facts | `G.caps.speechSynthesis` probe; the audio playback itself |
| Cadence & Projection guidance | `doctrine.entries` shape/store/route/search; `.list-detail` CSS | New doctrine content sourced from TC 3-21.5 (not yet authored); a small pre-round checklist UI |
| Navigation / discovery | `ROUTES`/`NAV_GROUPS`; `G.nav.seed()` handoff; Global Search's existing `"board"`/`"doctrine"` indexing | One new route (`#/recite`) and its render module |

**Sourcing gap this section inherits, not solves**: recitation practice
for the *existing* Preparation Drill content (all 10 names, FM 7-22's real
cadence/rep rules) can ship today. Exercise-by-exercise starting position
and per-count movement detail remain out of reach until ATP 7-22.02 is
acquired (§2.4) — this section should not be read as including
"PRT drill-by-count practice," only "creed and doctrine-passage recitation
practice," with PD content included at the level of detail FM 7-22 itself
provides.

### 3.4 Accessibility, Search, and UX Architecture

*(The search-indexing mechanics, nav placement, and the `views.*` vs.
`app-modules/*.js` question for this section are unified into §2.5–§2.7
above, since all four drafts converged on the same underlying
architecture once reconciled. This subsection covers source attribution
specifically, which no other section owns.)*

**Official source attribution: extend `source.ref`, reuse MOI's citation
normalizer, add one small Library nav-seed hook.** The codebase has two
existing citation shapes today — Doctrine's structured `{ref, para, asOf}`
object and board questions' flat string plus inline prose citation — and
neither is rendered as a hyperlink anywhere today. The closest thing to
citation-aware logic in the app is MOI Import's citation registry
(`moi-import.js:75-114` tokenizer, `156-161` alias table, `163-252`
`buildCitationRegistry()`, `259-282` `matchCitation()`), built for a
different purpose (matching an uploaded MOI's citations against the seed)
but structurally exactly the normalization step a citation-link feature
also needs.

1. **Creeds and PRT use Doctrine's structured `source: {ref, para, asOf}`
   shape** (already reflected in §2.3's schemas), not board's flat-string
   shape — consistency with the content family they're modeled after.
   Where para-level precision matters in body text, follow board's
   existing inline convention too (e.g. `"(ATP 7-22.02, para 3-2)"` in
   prose) so both the machine-readable and human-readable citation exist
   side by side.
2. **New helper, `G.citations.linkFor(ref)`**, built from existing pieces:
   runs `ref` through the same normalization `matchCitation()` already
   applies (extracted into a function both `moi-import.js` and this helper
   call, rather than forking the alias table), then looks the normalized
   citation up against `library.js`'s `DOCS_JSON` array by its `citation`
   field. A hit returns that doc's `id` and `pageCount`.
3. **One new integration point in `G.library.render`**: `G.nav.seed()` is
   a proven one-shot handoff already used by scenario/resource/career
   hits, but Library was never a consumer of it. Adding seed-receiving
   support to `G.library.render` (check for a seeded doc id on render,
   scroll/open to it) is the one genuinely new piece of plumbing this
   section proposes. A creed or PRT card's "View source" action then does
   exactly what a resource/career search hit already does:
   `G.nav.seed("library", docId); location.hash = "#/library";`.
4. **When `linkFor(ref)` finds no match** — every branch motto sourced to
   institutional heraldry, and ATP 7-22.02 until acquired — render plain,
   non-clickable attribution text instead of fabricating a URL: e.g.
   *"Source: TRADOC Infantry School institutional heraldry — not in
   Reference Library"* or *"Source: ATP 7-22.02 (pending acquisition)."*
   The app has no existing pattern of linking out to army.mil, the Central
   Army Registry, or a TRADOC branch page, and this design doesn't invent
   one — whether to add real outbound links later is an open decision
   (§5), not assumed.
5. **Duplication guard**: the three creeds that already exist verbatim in
   `board.questions` must not be re-typed into `creeds` a second time —
   `linkedBoardId` (§2.2/§2.3) is the mechanism, and
   `tools/find-content-redundancy.mjs` (already in this repo, built for
   exactly this class of drift) is the right tool to gate it at authoring
   time.

---

## 4. Phased Implementation Milestones

Following this project's own established delivery pattern (small,
independently-mergeable PRs; real CI/build verification before merge;
doctrine content double-checked against a real source before it ships,
not after) rather than inventing a different process for this initiative.

### Milestone 1 — Data Models & Search Indexing
- Add `GUIDON_SEED.creeds` and `GUIDON_SEED.prt` top-level keys (empty/
  skeleton — no content yet) per §2.3's schemas.
- Add `store.creeds()` / `store.prt()` accessors, `_hay` builders, and the
  two new `SECTION_ORDER`/`TYPES` entries in Global Search (§2.5).
- Add the `#/creeds`, `#/prt`, and `#/recite` routes to `ROUTES` and the
  `"prep"` `NAV_GROUPS` cluster (§2.6), each rendering a minimal
  "coming soon" placeholder page.
- Add `lines: []` support (optional field, unused until Milestone 3) to
  the `board.questions` schema documentation/validation, if one exists.
- **Done looks like**: all three routes are navigable and appear correctly
  in Global Search's zero-result "not indexed yet" removal, `npm run
  build` and `lint:patterns` pass, and a targeted regression test confirms
  the new accessors don't break existing `tierFilter`/search behavior for
  the six existing types.

### Milestone 2 — PRT Module (explicitly gated)
- **Prerequisite, blocking**: acquire ATP 7-22.02, add it to
  `docs-source/`, run `tools/build-library-data.mjs` (unblocks
  `#/library` access to it immediately, independent of the rest of this
  milestone).
- Author the drill-level `pd` record (cadence, rep rule) from FM 7-22 —
  this part is *not* blocked and can ship even before ATP 7-22.02 lands.
- Transcribe all 10 `PrtExercise` records' `startingPosition`/
  `movementDescription` from ATP 7-22.02, each with `sourceStatus:
  "verified"`.
- Build `tools/lint-prt-sources.mjs` and wire it into CI before the first
  verified record ships.
- Build the `#/prt` Hub UI (list-detail, "Run the drill" timer mode,
  "Quiz me on the order" SRS integration) per §3.1.
- **Done looks like**: all 10 exercises render with real, sourced text
  (never a placeholder shown as if populated), the drill timer runs a full
  cadence-paced sequence with `mm:ss` display, `noteExternalResult`
  correctly schedules each exercise id into SRS, and `tools/
  lint-prt-sources.mjs` is green in CI.

### Milestone 3 — Creeds & Memory/Study Tools
- Author `creeds` content in the sequence from §3.2 (re-home the 4
  existing verbatim entries first, then Combat Arms → Sustainment →
  Aviation/SOF → Cadet Creed last), each verified against its named
  source tier (doctrine / official-heraldry / unit-tradition) before
  merge — no branch motto ships from memory.
- Build the `#/creeds` reading-pillar UI (group chips, search, `.list-detail`,
  Print button) per §3.2/§2.6.
- Add `lines` to the existing Creeds-category `board.questions` rows.
- Build `#/recite` and the four study-technique modes (First-Letter,
  Chunking/Backwards-Chaining, Timed Recitation, Cadence & Projection
  checklist) per §3.3, including the shared `util.makeRoundTimer`/
  `fmtClock` refactor (used by both this and Milestone 2's PRT timer —
  sequence this refactor once, not twice).
- Author the new Board Room Conduct `doctrine.entries` rows from TC 3-21.5.
- **Done looks like**: all 15 requested creed/motto identities are
  present with correct `source.status` tagging, the three pre-existing
  creeds show no duplicated text (`find-content-redundancy.mjs` clean),
  and all four study-technique modes work against at least the Soldier's/
  NCO/Ranger creeds end to end.

### Milestone 4 — UX Polish, Accessibility, Cross-Linking
- `G.citations.linkFor()` and the `G.library.render` seed-receiving hook
  (§3.4) — wire "View source" actions on Creeds/PRT cards.
- Cross-links: a "Read the full creed" action on Creeds-category quiz
  cards → `#/creeds`; a "Recite this" / "Quiz me" action on `#/creeds`
  cards → `#/recite` / Board Drill (§2.2).
- Update the Home action-plan generator's existing `"nco creed"` entry to
  route through `#/creeds` first, per §3.2 §6 (re-verify the exact call
  site via grep before editing).
- Full accessibility pass on all three new routes (focus management,
  `aria-expanded` where applicable, keyboard navigation through the drill
  picker and study-mode toggles) — matching the standard this project
  already applies to MOI Import and other recent additions.
- Add the `{"a":"PD", ...}` Dictionary/Terms entry (§2.5 item 5).
- **Done looks like**: a Soldier can search "Essayons," land on the
  Engineer motto, tap through to the Institute of Heraldry attribution (or
  see the clean "not in Reference Library" fallback), and separately reach
  the same content from Global Search — all three navigation paths
  verified end to end, plus a full regression pass (`npm test`'s
  `test-search-*` suite extended to cover the two new types) before merge.

---

## 5. Open questions / explicitly out of scope

- **§2.7**: separate `app-modules/*.js` files for Creeds/PRT vs. inline
  `views.*` functions — both patterns are real precedent in this
  codebase; a recommendation is offered (start inline) but this is
  explicitly Chris's call, not settled by this document.
- **Does `tierFilter` (E1-E9 rank scoping) even apply to creed content?**
  A branch motto or the Soldier's Creed isn't rank-gated knowledge the way
  a leadership doctrine card is. The simplest honest default is `tier:
  "all"` on every entry and skipping the tier predicate in `store.creeds()`
  entirely — but that's a product call, not just an implementation
  default.
- **Does the Cadet Creed belong in this app at all?** Guidon is framed
  throughout as enlisted board prep (E1-E9); the Cadet Creed's actual
  audience (ROTC/OCS cadets) doesn't obviously overlap. Worth confirming
  before authoring it, not after.
- **Should `unit-tradition` entries carry a visible in-app disclaimer**
  (e.g. "traditional, not published in a numbered Army regulation")? This
  document recommends yes, consistent with this project's existing stance
  against implying false doctrinal authority, but treats it as a named,
  not-decided call.
- **Whether branch motto attribution should ever become a real outbound
  link to TRADOC/army.mil pages**, or stay permanent plain-text
  attribution (today's default, since no outbound-link pattern exists
  anywhere in this app yet).
- **ACFT prep's own data shape and doctrine-source check** (§3.1 §7) are
  both explicitly deferred, not designed here — scoped only as a future
  `prt.acft` placement decision.
- **Whether `G.library.render`'s new seed-receiving behavior (§3.4) should
  extend to Doctrine's existing `source.ref` values retroactively**, now
  that the plumbing exists, or stay scoped to Creeds/PRT for this phase.
- **Explicitly out of scope, matching this project's existing pattern of
  declining device-capability requests that cost more than they're
  worth**: no camera/OCR, no microphone-based voice-projection
  measurement, no accelerometer/heart-rate/wearable integration for
  "stress simulation." These were each considered and declined on their
  own merits during drafting, the same way this project has declined
  similar capability requests elsewhere — not gaps, deliberate scope
  boundaries.
- **Whether to ship `#/prt` now with FM-7-22-only content while
  ATP 7-22.02 is pending, or hold the route until acquisition lands.**
  Recommendation: ship now — Global Search and the nav route have no
  dependency on ATP 7-22.02, only the completeness of the per-exercise
  detail does, and a visibly-labeled "reference pending" state is honest
  about the gap rather than hiding the whole feature behind it.
