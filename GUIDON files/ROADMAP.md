# GUIDON — Roadmap

**Read this to know: what's shipped, what's deliberately not built (and why), and what actually comes next.** `GUIDON_PROJECT_MAP.md` is the 10,000-foot *what is this app* orientation; `CHANGELOG.md` is the session-by-session *what changed*; this document is the forward-looking one — pull from it to pick up where the last session left off, and keep it current going forward rather than letting it drift the way the other canonical docs already have once.

**Current version:** v1.12.1 (guidon-app/package.json), 2026-09-19 — audit-fix release: 54 confirmed defects from the 2026-09-15..18 merges fixed, runtime content packs brought under the same lints as the seed (one assembled bank: 1,230 board cards / 357 doctrine entries / 195 scenarios), and the release pipeline made to refuse a red commit. v1.11.0 and v1.12.0 were prepared but never released and are superseded by this version; v1.10.1 was published retroactively. One immutable tag feeds web/PWA + standalone, Android (signed on the owner's machine - see guidon-app/docs/release-runbook.md), Windows, macOS, iOS Simulator parity, and the ESP32 firmware/content fork. See CHANGELOG.md for distribution boundaries.

---

## 1. Completed initiatives

These are done — not "paused," not "mostly done." Nothing queued against them.

| Initiative | Scope | Where |
|---|---|---|
| v1.12.0: Leader readiness expansion | Collective Decision + 10-exercise Team Training catalog; persisted PT Planner with reminders/exports/history guard and shared PRT session blocks; offline Board Simulator; remaining AER/ACS/SUDCC/CSDP/DA Form 7923 board-study gaps closed; dedicated umbrella regression gate | PR #183 |
| Board-card content-accuracy project | All 984 board-question cards independently researched; zero duplicated/faked answer content remains | PRs #86–#88 |
| Enhancement backlog (2-pass full-app audit) | 86 findings across 2 audit passes, every tier (do-first through long-term) implemented | PRs #93, #95, #96, #97 |
| Roadmap-audit cadence, rounds 1–9 | Nine audit rounds — eight full 8-lens sweeps plus round 7 (scoped to fast/small/low-risk fixes only) | PRs #90–#92, #98, #106, #107, #112, #114, #138 |
| MOI Import Engine, Phase 1 | `#/moi` — import a board MOI, get a matched study dashboard + a disposable practice drill | PR #107 |
| Session-close cleanup (round 6) | Hyphenated-tier-range filter bug, one mis-filed self-check question, 6 dependency bumps, 2 CI races root-caused (not just re-run) | PR #108 |
| v1.5.0 release | First tagged GitHub Release — all 4 platform artifacts (standalone, web, Windows, Android), version bump, this document's own creation | v1.5.0 tag |
| Gradle-wrapper regression, caught and fixed live on `main` | A Dependabot major bump broke real Android builds despite passing CI clean (no job actually exercises a real Gradle build); reverted, dependabot.yml now ignores that specific bump | PR #110 |
| Round 7 (quick wins) | A real doctrine error, 2 a11y/UX gaps on `#/moi`, a new icon-registry test closing a real silent-fallback class, a Reminders double-read fix, and 9 test suites (including `test:moi-import` itself) found silently never running in CI, now wired in | PR #112 |
| `cargo check --locked` CI mystery, fully resolved | Two distinct, stacked root causes, each confirmed via direct evidence rather than assumed: (1) CI's Windows runner tracked whatever cargo shipped that week (1.98.0) while `Cargo.lock` had been generated locally by 1.96.0 — fixed with `rust-toolchain.toml` pinning the channel; (2) even after the pin, the *committed* `Cargo.lock`'s own `guidon` package version had silently been left at the pre-bump value while `Cargo.toml` moved on — fixed by committing that one-line diff. A version diagnostic step added to the CI job is what surfaced cause #1 after several blind re-runs. | PR #112 |
| Gradle-wrapper patch bump, verified before merge (not on CI-green alone) | 8.14.3 → 8.14.5, same major line as the reverted 9.7.1 regression above — checksum verified against Gradle's own published SHA256, plus a real `npm run android:debug` build run before merging, precisely because CI's own checks don't exercise a real Gradle build | PR #111 |
| Round 8 (full 8-lens sweep) | 20 real findings, 7 buckets: 3 DST-boundary date-math bugs (Progress heatmap, Leader reminders, Home sparkline), a Land Nav Drill keyboard-focus bug, 4 doctrine self-contradictions fixed against the app's own other content (M4 burst-fire, SGT/SSG semi-centralized promotions + retired-APFT reference, an Article 15 forfeiture-limit error, one last "DA Form 2977"→"DD Form 2977" instance), MOI Import hardened across 4 lenses at once (focus management, `aria-expanded`, confirm-before-discard, save toast, parallelized PDF extraction, new test coverage), 3 native-platform cleanups (an unused Android permission, a dead push-notification stub, a stale comment), 2 destructive Forms/POA "Clear" buttons gated to match the app's own confirm convention, and a genuine feature regression caught by bucket G's own test-coverage work (the Essay Drill → Doctrine cross-link had been left behind on an orphaned branch during round 6's merge and never actually reached `main` — restored, with real test coverage this time) | PR #114 |
| v1.6.0: Collective study rooms merge + security audit | The LAN room-networking feature (pinned self-signed TLS, a Rust/Tauri host listener, an Android native TLS plugin, a QR join flow) merged to `main`; a dedicated 11-lens audit then surfaced 20 findings, verified to 19 real ones, all fixed in the same release — an unauthenticated-crash HTTP parser bug, a TLS downgrade gap, an oversized-message crash on Android, replay/leak hardening, a full screen-reader-announcement pass, and a per-connection rate-limit guard among them. New: "What's New" in-app release notes (`tools/lint-patterns.mjs` check (h) enforces every version bump ships a matching entry). | PR #113 (merge), CHANGELOG v1.6.0 |
| v1.7.0: iOS ships via PWA, install-QR overhaul, fresh-install race fixed | The ~50%-of-fresh-launches "no cards" race (`store.boardQuestions()`/`.doctrine()`/`.scenarios()` memoizing an empty pre-load list forever) fixed by folding `!!state.seed.<x>` into each cache key. iOS became a real, permanent answer via the installable PWA (auto-deploys to GitHub Pages on every `main` push) rather than a stated gap. `#/share` now detects the visiting device's OS and serves the right install path; a from-scratch QR encoder's transposed format-info bits (silently unscannable on every real device despite passing its own self-consistency test) were found and fixed, verified against a real third-party decoder. Study Rooms now gates honestly (greyed out with an explanation) wherever no native shell exists. CI stability: per-chunk Chromium concurrency lowered from an unmeasured 8 to a verified-safe 4. | PRs #126, #127, #131, #132, #134, CHANGELOG v1.7.0 |
| GUIDON Flashcard OS (ESP32 handheld firmware fork) | A deliberately minimal, from-scratch firmware for a specific ESP32-32E handheld (ST7796S display, resistive touch, microSD) — flashcards plus topic/subject browsing, no drilling/grading. Shipped with display/SD/content-loading working but touch broken and tracked as a known gap; root-caused and fixed in a follow-up (SD card and display were fighting over the same VSPI bus — resolved with `USE_HSPI_PORT=1`) and confirmed working live on physical hardware. | PRs #128, #135, #137 |
| Content & Educational Materials expansion, Milestones 1–3 | Full design doc at `guidon-app/docs/design/content-education-roadmap.md`, all three build milestones shipped: (1) `GUIDON_SEED.creeds`/`.prt` data model + Global Search wiring; (2) `#/prt` Physical Readiness Hub — all 10 Preparation Drill exercises with real FM-7-22-sourced order/cadence/rep-rule, a cadence-paced drill timer, self-grading into the real SRS (per-exercise starting-position/movement text intentionally deferred, see §3 below); (3) `#/creeds` reading pillar (18 creeds/branch identities — 4 re-homed from existing verbatim content, 14 newly researched AND independently adversarially re-verified via a second live web-search pass before shipping, catching 2 real errors in the process) plus `#/recite` Recitation Drill (First-Letter Mnemonics, Chunk & Memorize with forward/backwards chaining, Timed Recitation, all reusing the existing SRS/timer plumbing). Verified live in a real browser each milestone, not just headlessly — caught and fixed 3 real runtime bugs (a `loadContent()` seed-wiring gap, a stale Pause/Resume label, a cross-module scope bug) this way. Full `npm test` (159 suites) run clean before merge. | commits `39be9e3`, `38e531c`, `73d749e`, `6944331` (direct to `main`, no PR) |
| Round 9 (full 8-lens sweep) | 24 findings across 8 lenses, weighted toward the just-shipped Content expansion above (its least-independently-scrutinized surface), synthesized into 8 buckets, each built by an isolated worktree agent and merged with zero conflicts: PRT/Recite shared round-timer accessibility (pause survives visibility toggle, no more `aria-live` spam on ticking clocks, real focus management, screen wake-lock — the app's first hands-free timer UI), Recite Chunk & Memorize's stale-async-render fix + chip-styled direction toggle, Creeds/Recite/PRT list-detail rows now update in place instead of destroy-and-rebuild (keyboard focus no longer drops to `<body>` on select, real arrow-key row nav added), a PRT/board-question rep-rule contradiction and an overstated doctrine-confidence tag reconciled, `#/prt`/`#/creeds`/`#/recite` given dedicated test coverage for the first time, `store.prt()` memoized, Kotlin version mirror re-synced + `ios.yml` SHA-pinned to match the other 3 workflows, and `@xmldom/xmldom` bumped past a higher-than-previously-tracked advisory surface. Two real merge-seam gaps (a test never wired into CI, a test checking a selector another bucket had correctly changed) and one real toolchain regression this round's own Kotlin bump exposed (`kotlin-compiler-embeddable`'s undeclared `kotlin-reflect` runtime dependency, breaking `test:tls-adversarial`) were root-caused and fixed before merge, not worked around. | PR #138 |
| Nav & Adaptive-Layout overhaul ("Smart Dock") | Full design doc at `guidon-app/docs/design/nav-adaptive-rail.md`, all 3 build milestones shipped: (1) a genuine landscape-phone breakpoint (was sharing the portrait flat-bar treatment) + the "More" drawer redone as a scannable "Sections" tile grid; (2) pinned favorites, with the phone dock's own 3 customizable slots derived directly from the pin list rather than a second, separate mechanism the design doc had originally sketched; (3) platform-flavor dock styling (Android tonal pill, iOS translucent blur bar, desktop unchanged), unblocked by resolving the doc's own open iOS-detection question first. Each milestone verified live under real device/viewport/UA conditions and a full 24-theme axe-core contrast sweep before merge; two real bugs found and fixed along the way (a Sections-drawer contrast failure in one theme, a pin-toggle focus-trap break). Two adjacent bugs the design doc flagged as worth fixing in the same pass (PRT `aria-pressed`, Recite focus loss) turned out to already be fixed on the long-stalled Round 10 branch — folded in via Round 10's own merge instead of being duplicated. | PRs #140, #141, #142 |
| Round 10 (6-bucket sweep) | Shared-util fixes every timed/async-button surface inherits at once (`util.busyButton` focus restoration, two distinct `util.makeRoundTimer` wake-lock leaks); 4 real doctrine-sourcing errors re-verified against the source PDFs (an inverted Parade Rest direction-of-address rule, an invented office-reporting script, a self-contradictory squad-drill citation, an over-asserted PRT rep-rule citation) plus a new structural test guarding the PRT numbers against drifting apart again; a 5-finding pass on Recite's Chunk & Memorize/Timed Recitation code (a stale-render guard that never actually guarded, a11y chip-styling, the Start/Stop focus fix, a timer/wake-lock cleanup gap, new regression coverage); Creeds' search-input ArrowDown handler and real click-driven tests for its 3 cross-link buttons; and two new **permanent** lint gates (`lint-kotlin-version.mjs`, `lint-workflow-pins.mjs`) closing drift classes rounds 4 and 9 had each already fixed by hand once. Resolved a real `git merge` conflict against the nav overhaul above (one `package.json` hunk, both sides' additions combined) before merging. | PR #139 |
| Round 11 (4-bucket sweep) | 11 findings across 8 lenses, synthesized into 4 buckets, all 4 merging with zero real conflicts despite every bucket touching `src/index.html`: the Nav overhaul's own pin-toggle focus-loss fix (Milestone 2, drawer only) turned out to have a sibling bug in the `>=600px` sidebar and `<600px`-landscape accordion (same `renderNav()` rebuild path, no capture/restore) — fixed by factoring the drawer's own logic into two shared helpers both paths now call, rather than a second copy; 3 unrelated ARIA-state gaps closed (three `role="option"` jump-list views missing the ARIA-required `aria-selected`, DA Form 4856's two button-groups and onboarding's rank picker missing `aria-pressed`); 2 more doctrine-content errors fixed after independent re-verification against source (Article 15/NJP's body text omitted Company Grade authority entirely; UCMJ Art. 86 AWOL conflated the 30-day duration threshold with desertion's actual specific-intent element, now correctly tied to DFR processing instead); and 3 small hygiene fixes (a stale Gradle comment describing code round 8 already deleted, `package.json`'s own `_engines_note` citing the wrong `@capacitor/cli` Node floor, `store.recitable()` now memoized like its five siblings). One low-severity finding (`G.modal`/`WhatsNew`'s duplicated hand-rolled focus-trap logic) deliberately deferred — see §5. | PR #145 |
| ATP 7-22.02 acquisition (closes §3's former open item) | User authorized a web search + confirm-before-download; sourced directly from armypubs.army.mil (ARN45013-ATP_7-22.02-001-WEB-4.pdf, published w/ Basic incl. C1), added to `docs-source/` (now 16 core publications), `tools/build-library-data.mjs` re-run. All 10 Preparation Drill exercises' `startingPosition`/`movementDescription` hand-transcribed verbatim from Chapter 3 (paras 3-3–3-13) via `tools/seed-io.mjs`, marked `sourceStatus:"verified"`, `tools/lint-prt-sources.mjs` (built exactly to this purpose back when the blocker was first documented) confirms the gate. New test-prt.mjs coverage added for the render path (was previously untested — `sourceStatus==="verified"` branch had zero coverage even before this). Where the source doctrine text itself only prints counts 1–3 for an exercise (Forward Lunge, Prone Row, Push-Up), transcribed exactly as printed rather than inferring a symmetric closing count. | direct to `main` |
| ACFT/AFT module scoping: ATP 7-22.01 acquired | Module scoped to a standards reference/lookup (browse the AFT's 5 events + real age/gender scoring tables, read-only) — a calculator and tracked-history module deliberately deferred until this ships first. ATP 7-22.01 (Holistic Health and Fitness Testing) sourced from armypubs.army.mil, added to `docs-source/` (17 core publications). The AFT's actual raw-score-to-points tables live only at a separately-maintained `army.mil/aft` page, not in any numbered publication — blocked by a persistent, confirmed site-wide 429 (retried once after ~12 hours, still blocked via both WebFetch and a real browser session) and left deliberately deferred, no rush, per the user's own call. | direct to `main` |
| Rapid Fire Team "steal" mechanic: "Handoff Steal Round" | Four design candidates adversarially judged before any code was written; the chosen design reuses Team mode's existing `onFinish` handoff seam rather than needing any change inside the shared round engine. A second adversarial review pass over the actual diff caught two real bugs a 24-assertion E2E suite alone had missed: a merge-order priority gap that could silently evict an already-chained-forward card, and a redundant "pass the device to yourself" handoff screen. | PR #149 |
| Doctrine confidence-field backfill | 32 of 355 `doctrine.entries` records were missing the `confidence` field that drives `#/doctrine`'s own "Show 'in transition' doctrine"/"Show community content" toggles — silently always shown regardless of toggle state. 8 parallel research batches + an adversarial consistency-review pass tagged all 32 (340 verified / 8 in_transition / 7 community total) and surfaced 3 real content bugs along the way (a rank-ladder shift, a superseded TCCC citation, a wrong EO citation). New permanent `tools/lint-doctrine-confidence.mjs` gate. | PR #156 |

See `CHANGELOG.md`'s v1.5.0 through v1.8.2 entries for the detailed version of all of the above.

---

## 2. The roadmap-audit cadence is a standing practice, not a finished project

Whenever the backlog above is exhausted and someone asks "what's next," the answer is: run another round. This has held for 11 consecutive rounds and has no natural end.

**The pattern**, refined across all 11 rounds:
1. An 8-lens audit (correctness / accessibility / content-accuracy / native-platform / dependency-hygiene / test-coverage / performance / UX-consistency), each lens explicitly primed with everything every prior round already fixed, so it doesn't waste a pass rediscovering settled work.
2. Raw findings synthesized into buckets — before dispatch, manually scan for any file/route mentioned 3+ times across different buckets and consolidate those into one dedicated bucket (cuts merge-conflict risk at the highest-collision area; empirically took one round from 3 manual conflicts to zero).
3. Each bucket implemented by an independent Workflow agent in its own isolated git worktree, all dispatched in parallel.
4. Merged sequentially into one integration branch. A conflict on GUIDON's single-line `window.GUIDON_SEED` blob is common even when the actual edits don't overlap (git can't see sub-line structure) — resolve with a brace-balanced extractor script, never a blind text merge, and always re-verify the resulting seed parses as valid JSON with the expected counts before committing.
5. Headless verification (`npm run build`, `lint:patterns`, a targeted regression batch scoped to what the round touched, the full `verify.mjs` sweep), then PR, then CI.
6. A "confirmed recurring CI flake" is not license to stop looking — two signatures logged as benign flakes across earlier rounds (`rapid-fire-solo-team`, `test-nav-tier2ab`'s new-tab assertions) turned out to be real, fixable timing races once someone actually looked at the mechanism instead of re-running a third time. Treat a signature that keeps recurring as a lead, not a shrug.
7. A real-condition poll (`page.waitForFunction`) can still fail under CI's worst contention if its *patience* is too tight — that's a different bug from the original "used a fixed wait instead of a real condition" class. Round 8 found `rapid-fire-solo-team`'s already-correct poll (fixed in round 6) timing out at 5000ms specifically on the FIRST call in a run, right after fresh page boot under an 8-concurrent-Chromium chunk; every later call in the same run passed in under a second. Fix was to widen the timeout (5000ms→15000ms) on the same correct mechanism, not to add a new fixed wait — confirmed via the CI log which call actually timed out before touching anything.
8. If a round's own integration branch goes stale behind other work landing on `main` in the meantime (round 10 sat 5 days behind the Nav overhaul above before merging), resolve with a real `git merge` of `main` into the branch — never a rebase of a branch containing its own internal merge commits, which linearizes and confuses more than it fixes. A genuine content conflict (both sides add something new to the same file, e.g. `package.json`'s script list) needs both additions kept, not one side picked; re-verify with a full local suite run before merging in either direction. Separately: merging a STACKED chain of several small PRs (each based on the previous one's own branch) needs `git rebase --onto <new base> <old base tip> <branch>` on every dependent branch each time an earlier one squash-merges — a squash rewrites commits under a new hash, so a plain merge would show the same content twice under two different histories instead of retargeting cleanly.
9. A browser-only viewport-resize check is not the same as verifying on the real device class a fix is named for. v1.8.1's own nav-pin fix was verified in a resized browser tab (the generic 600-799px and >=800px desktop tiers) and shipped clean — but `html.device-fold-narrow`, a real, CSS-scoped tier that exists specifically for one physical device this project has on hand, was never spoofed in that pass, and it had a genuine specificity gap the other tiers didn't. It surfaced only because the release-distribution step includes installing on that exact hardware and actually looking, not just trusting green CI. When a fix touches device-conditional CSS/JS, spoof (or drive) every named device class the code branches on, not just the width breakpoints — a device-detection class can carry different specificity/behavior than a plain media query at the same width.

**To start the next round**: no ceremony needed — just ask. The same 8 lenses, primed against this file plus the latest `CHANGELOG.md` entry, is the whole kickoff.

---

## 3. RESOLVED (2026-09-13): ATP 7-22.02 acquired — the one open item from the Content expansion above

Milestones 1–3 of the Content & Educational Materials expansion (§1 above)
were done and live on `main`, with exactly one piece explicitly deferred,
not forgotten: **ATP 7-22.02** (Physical Readiness Training) — the real
Army manual with each Preparation Drill exercise's starting position and
movement description — was confirmed absent from
`guidon-app/docs-source/`. That gap is now closed — see §1's own entry for
the acquisition and transcription detail, and
`docs/design/content-education-roadmap.md` §2.4 for the full technical
history of what was blocked and why (marked RESOLVED there too, kept for
the record rather than rewritten).

This was the user's call, not an autonomous fetch/download, exactly as
this section originally required: offered a choice of supplying the PDF
directly, authorizing a web search for an official public-domain source
with a confirm-before-download step, or leaving it as-is — the user chose
the web search, the exact source and file size were confirmed back to the
user before any download happened, and only then was the ~15.5 MB PDF
fetched from armypubs.army.mil.

---

## 3b. IN PROGRESS: ACFT/AFT module scoping — one source acquired, a second one raised

Started at the user's explicit request to scope the ACFT/AFT module next.
Two real decisions surfaced, resolved in different ways:

**Module scope, decided**: start with a standards reference/lookup — browse
the AFT's 5 events and their real age/gender scoring tables, read-only, no
personal data stored. A score calculator and a full tracked-history module
(reusing Progress's existing heatmap/trend-chart infrastructure) were
considered and explicitly deferred to a later pass once this narrower
scope ships.

**First source, acquired and resolved cleanly**: `docs/design/content-
education-roadmap.md` §3.1 §7 had flagged, unverified, whether FM 7-22
already carries AFT scoring content or a new source was needed. Confirmed
this session: FM 7-22 carries none (direct text search, zero hits).
GUIDON's own pre-existing board questions (`acft-10`, `acft-11`) already
cited **ATP 7-22.01, Holistic Health and Fitness Testing (12 March 2026)**
for AFT administration/grading detail — verified those citations verbatim
against the real document after acquiring it, no corrections needed.
Sourced the same way as ATP 7-22.02 above: user-authorized web search,
confirmed live on armypubs.army.mil (ARN46104-ATP_7-22.01-000-WEB-1.pdf,
~9.5 MB) before download. Added to `docs-source/` (Reference Library now
17 core publications), `tools/build-library-data.mjs` re-run.

**A second, genuinely new sourcing question, raised rather than resolved
unilaterally**: ATP 7-22.01 itself does not carry the AFT's numeric
raw-score-to-points conversion tables — para 2-30 explicitly defers those
to "the AFT event score conversion tables posted to the AFT website at
https://www.army.mil/aft," a separately-maintained resource at a
different URL, not a numbered Army publication. A direct fetch of that
page hit an HTTP 429 rate limit this session. Several third-party
fitness-calculator sites republish AFT score charts, but none are an
official DoD source — this project's doctrine-accuracy discipline (no
content shipped without a real, verifiable source) rules those out same
as it would any other unverifiable secondary source. This is the actual
data the "standards reference/lookup" scope needs, so it's a real
blocker, not a formality — raised to the user for how to proceed
(retry the official fetch, user supplies the table directly, or descope
the module to protocols/event-descriptions only until sourced) rather
than filling it in from training-data memory or an unofficial mirror.
**User's call (2026-09-13): retry the official army.mil/aft fetch in a
future session** once the rate limit has genuinely cleared, rather than
hammering it now or descoping. No work lost either way — PR #151 (ATP
7-22.01 acquisition) ships regardless.

**Retried (2026-09-14), and this is now genuinely deferred, not just
paused.** The retry didn't just hit the same per-request 429 again — it
confirmed something stronger: `army.mil` itself (not just the `/aft`
path) returns a site-wide 429 from this environment's network, via BOTH
the fetch tool and a real browser session, having now persisted across
many hours. That's the signature of an infrastructure-level block on this
environment's own outbound path to army.mil, not a transient per-request
throttle that more waiting or a different tool will clear. One genuinely
useful thing was confirmed along the way: Army Directive 2025-06 (the
policy that established the AFT, fetched cleanly from armypubs.army.mil)
states outright in para 6.b that TRADOC/G-3/5/7 "will publish a new
scorecard and accompanying score standards" as a *separate* artifact —
consistent with ATP 7-22.01's own pointer, and ruling out any chance the
numbers are embedded in the directive itself. **User's call: leave it
deferred, no rush** — `#/prt`/AFT reference content ships fine without
the numeric tables (same honest "reference pending" pattern used
elsewhere), and the recommended real unblock is the user visiting
army.mil/aft from their own network (likely unaffected by whatever is
blocking this environment) and sharing the content directly, whenever
they're ready — not another autonomous retry.

---

## 3c. SHIPPED (2026-09-14): Rapid Fire's Team "steal" mechanic

Started at the user's explicit request to raise the Team "steal" mechanic
design next — the last remaining item from the Rapid Fire v2 quick-wins
brainstorm, previously deprioritized as "the most complex/ambiguous
remaining item... no concrete design decided yet given the sequential/
pass-the-device architecture doesn't support real-time buzz-in."

**Design, not just implementation, was genuinely undecided** — the
original spec's own one-liner ("if Team A passes, Team B gets a shot at
the same card before moving on") doesn't fit the real architecture
(each team gets exactly one uninterrupted turn; there's no live buzzer,
no second device). Four real design candidates were generated and
adversarially judged before writing any code: a real-time mid-turn freeze
(most literal to the spec, but reaches into the shared round engine and
self-admitted an unguarded Escape-key gap), a pooled end-of-game
shout-it-out finale (fun, but honestly a different mechanic requiring a
second mini-engine built from scratch), a scoreless read-only digest
(safest, but by its own honest assessment barely qualifies as a steal
mechanic), and the chosen **"Handoff Steal Round"** — deferred to the
existing handoff moment rather than the literal "before moving on,"
needing zero changes inside `beginRound`/`judge`/`advance`/`finishRound`
by reusing the exact `onFinish` seam Team mode already chains its own
turns through.

**A second adversarial pass, this time over the actual diff before
shipping, caught two real bugs no amount of manual review or the
24-assertion E2E suite alone had surfaced**: (1) a genuine correctness
gap where `MAX_STEAL_CARDS`'s cap could silently evict an already-
chained-forward card in favor of the receiving team's own newer passes
— found, fixed (a merge-order priority fix), and proven with a dedicated
regression test that was itself verified to actually fail against the
reverted bug before being trusted (it didn't, the first time — a
coincidental card-identity overlap in the test's own random shuffle was
masking the bug about half the time, fixed by excluding that specific
card from the test's own generated passes); (2) a low-severity but real
UX inconsistency where the screen right after resolving a steal offer
re-instructed the same team to "pass the device" to themselves, fixed
with a small "device already here" flag threaded through the existing
handoff screen.

Verified: `lint:patterns`, full local suite, and 30 real E2E assertions
in `tools/test-rapid-fire-steal-round.mjs` covering the offer/accept/
skip/zero-pass/first-team/last-team/cap/chain/priority-fix/copy-fix
behaviors — including a real 3-team chain proof (a card accepted-and-
re-passed during one team's own steal round correctly flows forward into
the next team's own offer) and the regression test's own before/after
verification against the fix it exists to guard.

---

## 3d. SHIPPED (2026-09-14): doctrine confidence-field backfill

Started at the user's explicit request to raise the doctrine confidence-
field backfill next — the remaining backlog item explicitly flagged as
"requires real per-entry content judgment, not mechanical." 32 of 355
`doctrine.entries` records shipped with no `confidence` field at all
(`"verified"` / `"in_transition"` / `"community"`, per the seed's own
header note). Not just an accuracy gap: `#/doctrine`'s own base-list filter
reads that field to drive the real "Show 'in transition' doctrine" /
"Show community / supplementary content" Settings toggles — an entry with
no field at all is neither value, so it always showed regardless of toggle
state, a real (if minor) filter-correctness bug for any of those 32 that
should have been hideable.

**Methodology**: 8 parallel research batches (4 entries each), every batch
independently web-verifying current doctrine status rather than defaulting
every untagged entry to "verified," followed by a dedicated adversarial
consistency-review pass that re-searched every one of the 32 proposals
from scratch (not just re-reading the first pass's sources) before any
were accepted. Final distribution: 340 verified / 8 in_transition / 7
community (out of 355 total).

**Three real content bugs were found and fixed along the way** (the same
"fix confirmed errors when found" discipline as prior rounds, without
expanding into a full citation-currency refresh of the other, merely-
stale-but-still-accurate "verified" entries — a separate, larger project
out of scope here):
- `ncopds-ladder`: the course-to-rank ladder was off by a full rank
  (BLC/ALC/SLC actually gate SGT/SSG/SFC, not SSG/SFC/MSG; MLC is
  *becoming* the MSG gate as the ongoing NCO PME redesign fields it).
- `doc-tccc`: cited TC 4-02.1, superseded in March 2026 by ATP 4-02.11
  (Casualty Response, Tactical Combat Casualty Care, and First Aid); the
  entry's other citation, ATP 4-02.84, turned out to be an unrelated
  multiservice biological-casualty TTP, dropped rather than kept.
- `doc-eo`: a secondary citation, "AR 27-26" (Legal Services: Rules of
  Professional Conduct for Lawyers), was unrelated to Equal Opportunity
  and not referenced anywhere in the entry's own body — dropped.

**New permanent lint gate**: `tools/lint-doctrine-confidence.mjs` (wired
into `lint:patterns`) fails CI if any future `doctrine.entries` record
ships without a valid `confidence` value, the same mechanical backstop
`lint-prt-sources.mjs` already provides for `PrtExercise` records.

Verified: `lint:patterns`, full local suite, and a new
`tools/test-doctrine-confidence-filters.mjs` proving the toggle behavior
end-to-end against real seed content — a genuine in_transition entry and a
genuine community entry (picked live from the seed, not hardcoded) each
hide when their matching toggle is off and reappear when it's back on,
while a verified control entry stays visible throughout.

---

## 3e. TCCC-first lane + cross-subject cohesion, team-building catalog, and PT Planner SHIPPED

Two "monumental addition" requests, each explored via an independent
4-candidate design workflow (adversarially scored and synthesized), with
every real decision point locked in by the user via multiple choice
against the judge's own recommendations. **Full design docs, locked
decisions, and named open engineering risks**:
`guidon-app/docs/design/casualty-care-and-cohesion.md` and
`guidon-app/docs/design/pt-scheduler.md`.

**Casualty care/land nav/grid/MEDEVAC, locked build order — all three items now SHIPPED**: TCCC-first (`sc-tccc-ied-strike`, an 11-node branching, consequence-based STX lane extending the app's existing scenario engine, not a new content type — [PR #159](https://github.com/CosmicGrub/The-Guidon/pull/159)), then the 9-line MEDEVAC builder (`sc-medevac-9line-callin`, 13 nodes — [PR #160](https://github.com/CosmicGrub/The-Guidon/pull/160)), then a real SVG click-to-place grid-plotting mode for Land Nav Drill (`plotMode()`, the drill's 4th mode — [PR #161](https://github.com/CosmicGrub/The-Guidon/pull/161)). All three shipped in v1.9.0; see `CHANGELOG.md` for the full technical detail on each, including every content-accuracy defect the adversarial-review pass caught and fixed before shipping.

**SHIPPED in v1.12.0**: the cross-subject cohesion mechanic, "Scenario Relay + Collective Decision" (a `discuss:true` group-decision node flag on the same shared scenario engine — retrofits onto every existing scenario for free, now that the TCCC/9-line lanes have proven real content plays well on the unmodified engine, satisfying the design doc's own "probe with 1-2 STX lanes first" sequencing note). A minimal, manually-updated leader Squad Roster ships alongside it. The 10-exercise doctrine-grounded team-building catalog ships in format-band phases (icebreaker/config-only first, then high-stress/blind-trust, then content-dependent exercises — now unblocked, since TCCC/9-line content exists).

**PT Planner — SHIPPED in v1.12.0:** reconcile the two duplicate PT-session
datasets (`#/prt`'s verified single-drill engine vs. `#/drills`' full-
session checklist) using a documented placeholder table so it ships
without waiting on all new drill content to be fully doctrine-sourced
first. Day-one intelligence is "defaults + a flagged history check" (day-
of-week template + a non-blocking 3:1 hard:recovery-ratio warning, not a
full auto-adjusting rule engine). A persisted, hand-editable day/week/
month schedule, a hybrid template-library-plus-suggestion interaction
model, a reused-checklist-plus-export leader tie-in (not a full roster
module), and notifications on the existing single-fire reminder pipeline
(not new recurrence infrastructure) round out day one.

**Day-one doctrine fixes — shipped, not just planned**: `doc-tccc` and
`doc-tccc-1` were two overlapping, unreconciled TCCC doctrine cards
(`doc-tccc-1` cited the superseded TC 4-02.1 despite carrying
`confidence:"verified"`). Verified directly against the real, current ATP
4-02.11 (23 March 2026) and ATP 4-02.2 (12 July 2019) source PDFs before
writing anything: `doc-tccc-1` retired; `doc-tccc` extended from MARCH-only
to the actual current MARCH-**PAWS** protocol (Pain/Antibiotics/Wounds/
Splinting is genuinely the second half of the doctrine, confirmed present
in the source text — a real completeness gap, not previously known) and
its "DA Form 1380" citation corrected to "DD Form 1380" (a Department of
Defense form — this had been silently self-contradicting the app's own
`tc4021-9` board question, which already said DD Form 1380 correctly).
The previously-nonexistent 9-line MEDEVAC doctrine card (`doc-medevac-
9line`) was added, sourced verbatim-in-substance from ATP 4-02.2's real
Appendix C, Table C-1. New regression coverage:
`tools/test-doctrine-tccc-medevac-accuracy.mjs`.

---

## 3f. Reconciled content expansion — readiness/taxonomy/Mock Board SHIPPED; cadences remain policy-gated

A wide-ranging brainstorm session (Integrated Operational Thinking model,
an SGT-board study module, a full System-A/B curriculum-and-simulator
spec, and an Army-cadences research pass) produced a large amount of
draft content and several proposed new systems. **Reconciliation
decision, locked**: none of it becomes a new database, a new tier
hierarchy, or a live-AI/server architecture — GUIDON stays single-file,
offline-first, zero-server. Every idea maps onto an *existing* schema,
section, or engine (`G.engine`, the 984-card `board.questions` set, the
rank-tier filter, the SRS/category-mastery system already in `#/board`)
as additive fields and new content, not parallel systems. Full mapping
table and reasoning: this session's own conversation record (not yet
extracted to its own design doc — do that before this section grows
further).

**Quick wins (Phase 0 — pure content/small UI, no policy decisions
blocking them):**
- A `pillar` tag (one of 6: Doctrinal Thinking, Programs & Support,
  Leadership/Counseling, Maintenance & Supply, Training Management,
  D&C/Board Etiquette) added as an optional field across doctrine
  entries, scenarios, and board questions — Private/Specialist/Jr. NCO
  "tiers" are the *existing* E1–E3/E4/E5 rank-tier array, not a new
  hierarchy.
- Missing Army Program board questions: AER (AR 930-4), ACS (AR 608-1),
  and SUDCC — SHARP and EO already have real coverage in the existing
  984-card set, confirmed directly from the seed; these three are the
  actual gap. SUDCC's exact current governing publication needs
  verification before it ships as `confidence:"verified"` (program
  naming has shifted amid Army substance-abuse-care reorganization).
- Three new Vertical/Lateral-thinking `G.engine` scenarios (field
  exercise comms blackout, motor-pool PMCS/safety-vs-schedule, range
  safety-vs-schedule) — zero new engine code, same schema as
  `sc-tccc-ied-strike`.
- New doctrine entries for the 4-phase counseling process (already-cited
  ATP 6-22.1), CSDP/FLIPL/Statement of Charges (AR 735-5), and the
  8-Step Training Model (ADP 7-0) — each needs the standard
  fetch-and-verify pass against the real PDF before shipping, per this
  project's own citation-honesty discipline; TC 3-04.7 does not appear
  to actually govern ground PMCS (looks aviation-specific) and needs a
  corrected citation, not the one originally proposed.
- A topic-chip bar for Board Drill's category picker, reusing the
  `.search-filters`/`.chip.search-chip` idiom already copied 4 times
  elsewhere in this app (Doctrine → Dictionary → Resources → Scenario
  Library) — replaces/augments the current plain `<select>`, zero new
  data model.
- A `lint-board-taxonomy.mjs` gate (mirroring `lint-doctrine-
  confidence.mjs`/`lint-prt-sources.mjs`) so a 79th near-duplicate
  category string or a newly-added, unparseable `source` string can't
  silently ship — directly enforces the standing rule that every new
  sourced fact also gets a board card ([[guidon-content-pipeline-board-
  cards-rule]] in memory).

**Bigger investment (Phase 1–2, sequenced, not blocking Phase 0):** a
"Board Readiness Score" rollup (a formula over scores that already
exist — category mastery + scenario attempts — not a new tracker); a
"5-Minute Board Reps" daily view (a smarter query over the existing
SRS due/leech queues, not a new engine) — **SHIPPED 2026-09-15 (PR
#168)**: Home card → a capped 12-grade set composed from Board Drill's
own ordered queue (due first, then leeches, then the Readiness tab's
weakest-3 categories), no mid-set reinsertion, per-day record under
`G.board.repsKey()`, plus the Home due-card now landing on the due-only
queue; a structured `regulation`
field decomposed from board questions' existing free-text `source`
string (984 cards, ~12% compound citations — a real multi-wave content
migration, same shape as the already-completed board-card-accuracy
project, not a quick edit); a Mock Board Simulator built as a deep
`G.engine` scenario tree (or a few linked scenarios per phase) plus a
themed UI wrapper — explicitly NOT a live generative-AI opponent
(would make this the app's first-ever online-required feature) and NOT
the literal PostgreSQL/REST-API architecture originally proposed for it.

**Cadences — research complete, content-policy decisions pending.** A
103-agent research pass (Wayback/archive.org-backed, two independent
runs after a session-restart casualty) found: no Army doctrinal source
for cadence lyrics exists (confirmed against ~70 years of drill
manuals), but the U.S. Army Center of Military History runs a real,
citable "Drill Sergeant Tool Kit → Jody Calls" page with full text for
a dozen-plus heritage/contemporary cadences — the strongest available
source class. Result: ~35 cadences cleared for inclusion outright
(clean unit-pride/comic/endurance content, several independently traced
decades before any website); a firm exclude list with real sourcing
(most notably "Napalm Sticks to Kids," the one title with genuine
academic/journalistic documentation of formal prohibition); a real
copyright landmine caught before shipping (one title presented as
folklore by an aggregator site is actually a working musician's
actively commercial-licensed 2022–2023 song); one unresolved conflict
(two contradictory copyright verdicts on the same title, "Around Her
Hair / Yellow Ribbon," needs a real musicologist/legal read before
either version ships); and several titles (including "I Wish That All
the Ladies") that are real and old but need an explicit content-policy
call (default-off/opt-in/exclude) rather than default inclusion.
**Blocked on**: the policy decision for the borderline titles, and
deciding where this content actually lives in the app (new route vs.
folded into Creeds & Branch Identities) before any of the ~35 cleared
cadences ship as real content.

---

## 3g. NEXT: make the 2026-09 feature sets registered parts of the app, not patches on it

Source: `GUIDON files/AUDIT-2026-09.md` section 6 (the audit of PRs #172-#183 and the v1.12.1 fix release). The new tools - Board Simulator, Team Training, PT Planner, the Cybersecurity & OPSEC curriculum, the 92A deck, Study Rooms mixed decks, My unit - arrived as runtime modules that wrap core functions and push content into the seed at load. v1.12.1 put lints around that (`tools/assemble-bank.mjs`, `tools/lint-content-packs.mjs`); the items below remove the need for the workaround. Nothing here is started. Each is sized to land green on its own.

**Now (small):**
- A. Module manifest with named extension points (`{ id, requires, provides, routes, storageKeys, contentPack }`), replacing alphabetical load order and function wrapping; plus a lint that a `typeof G.x.y === "function"` guard names an API some module declares. v1.12.1's integration found a guard that silently skipped a classification-marking refusal because the guarded function had been removed by another branch.
- B. Backup validators for the new storage keys (`board:sim:v1`, `team:training:v1`, `prt:plan:v1`, `pt:history:v1`, `recall-ladder:*`, `guidon:recite:own:v1`), and one app-wide decision on Guest/Kiosk writes.
- C. Shared test helpers (`clickWhenStable`, `waitForRoute`) under a lint ratchet on swallowed waits; new-suite scaffold derives counts from the live bank (three suites broke on a literal deck size in one week).
- D. Generated content floors instead of hand-bumped literals.

**Next (structural):**
- E. Build-time content packs behind one API (`G.contentPack.define(...)`), merged into the seed by the build. The single highest-value change: every tool that reads the seed sees one bank by construction. Five-step migration, ids and study history preserved.
- F. Structured citations (`{ pub, edition, para, quoteKind }`) so "verbatim" headings, regulation chips, the superseded-publication check and the rights gate are mechanical.
- G. MOS decks as a first-class opt-in lane with their own Readiness row (92A is the first of many).
- H. A real `G.engine.run()` completion contract; Collective mode as an engine render mode; Board Simulator on a phase registry.
- I. ~~One PRT session model shared by PT Planner, `#/prt` and `#/drills`~~ — **two-thirds shipped.** PT Planner and `#/prt` are unified: `DEFAULT_PRT_SESSIONS`/`DEFAULT_PRT_PENDING_DRILLS` moved out of `pt-planner.js`'s own module-load-time seed mutation (`ensurePrtSessionModel()`) and into core's own seed normalization (`src/index.html`'s `loadContent()`), so `window.GUIDON_SEED.prt.sessions`/`.pendingDrills` are guaranteed present the instant the seed loads, read everywhere via `store.prtMeta()`, regardless of module load order. `#/drills`' own Leadership Drills module (`prtDrill()` and its local `PD`/`RD`/`PRT` consts in `src/index.html`) is deliberately deferred to a small follow-up: a separate, already-in-progress fix to that module's content-integrity (unsourced exercise names that should read "(content pending)") needed to land first without a concurrent structural refactor colliding with it. Once that fix merges, wiring `#/drills` through `store.prtMeta()` the same way `#/prt` already does is the remaining third.

**Later:** data-driven What's New; the legal package as a verified, version-stamped artifact; macOS launch proof, a fixed-name Mac download and notarization-readiness; Study Rooms carrying PT plans and Team Training sessions; per-unit content packs; lanes on the ESP32 handheld.

**Owner decisions outstanding:** listed in the audit's section 5 (twenty items: repository settings, rights and content, product behaviour, release and platform).

## 4. Deliberately not built — and why

Not gaps. Each of these was scoped, considered, and declined on its own merits. Revisit only if the stated condition changes.

### MOI Import, Phase 2 — soft prioritization
Extend `#/learn`'s existing rank-aware re-sort pattern (surface matched-topic content first, hide nothing, one-tap "show everything") to Board Drill and Doctrine. **Evidence-gated**: build this only once Phase 1 (the dashboard) sees real usage and people are asking for more than a reading list.

### MOI Import, Phase 3 — a true global content filter
The feature as originally imagined: matched topics stay, everything else app-wide hides. **Not recommended, not just "later."** GUIDON's citation data is 584 distinct strings hand-authored across 9 independent places with no shared alias table; real regulations collide at 1–2 characters (`AR 600-8-2` is a literal substring of `AR 600-8-22`; `TC 3-21.5`/`TC 3-21.8` differ by one digit and cover unrelated subjects). A hard hide on a bad match means a Soldier sees a confidently-empty section the night before a real board. It would also become a second permanent content-scoping system alongside the existing `tierFilter` — a standing maintenance tax, not a one-time cost. Revisit only if Phase 1 usage shows people repeatedly asking to *hide* non-MOI content, not just prioritize it.

### Photo/camera capture for MOI import
No camera or OCR infrastructure exists anywhere in this codebase today. Findings if this is ever picked up: **Windows is the cheap path** — `Windows.Media.Ocr` is a built-in, on-device OS API reachable via a Rust crate already transitively present in `src-tauri`'s own dependency tree (pulled in by Tauri's WebView2 backend), and camera capture needs zero new code (WebView2 already supports standard `getUserMedia()`). **Android is real but has an actual cost** — `@capacitor-mlkit/text-recognition` is real and version-matched to this project's Capacitor version, but bundles all 5 script recognizer models directly into the APK (several MB apiece), not a free on-demand download. **The standalone single-file build can never do this** — no OS to hand the OCR job to from plain browser JS; it stays on paste, permanently, on principle. If ever built: Windows first, Android as its own separately-weighed decision, paste stays the universal floor everywhere.

### GitHub repo security settings (Dependabot alerts, secret scanning, push protection)
Repo configuration, not code — outside the standing session authorization that covers software changes. Flagged as a recommendation for the user; never auto-toggled.

---

## 5. Known, tracked, low-priority

Small, real items — not urgent, not forgotten.

- **ADP 7-0 self-check category**: audited in full (all 15 items) as of v1.5.0; one genuine mis-file found and fixed. Closed, not open — listed here only so a future pass doesn't re-audit it from scratch without checking this file first.
- **`GUIDON_MASTERFILE.md` and `GUIDON_PROJECT_MAP.md` numbers drift between updates** — both documents say so about themselves. Prefer deriving a figure live (`tools/declared-routes.mjs`, or a direct seed query) over trusting a hand-written count in either document, this one included, if the figure matters for a real decision.
- **Dependabot alerts and security updates are disabled repo-wide** (confirmed round 8, `gh api repos/.../security_and_analysis`) — the repo is public, so this costs nothing to enable, but it's a GitHub repo setting, not code, so it falls under the same standing exclusion as other repo-security-settings recommendations (§4 above): flagged for the user, never auto-toggled. This is *why* the `@xmldom/xmldom` advisory below sat unnoticed — a transitive dev-only advisory that never generated a scheduled-bump PR because it's a security-triggered update and those are off.
- **`@xmldom/xmldom` 0.9.10→0.9.12** (dev-only, via `@capacitor/cli`→`plist`) — APPLIED round 9, lockfile-only bump (`plist` already allows `^0.9.10`, so no `package.json` change was needed). Re-checked before applying because this bullet's own prior wording ("zero-risk... low urgency") undersold it: the resolved 0.9.10 sits inside the vulnerable range of *multiple separate high-severity* GHSA advisories, not just the one medium-severity GHSA-6gmq-8vp8-gcm6 originally cited here — e.g. GHSA-w2rr-34g9-rvrj and GHSA-4w3w-2rp5-g8jm (both `>=0.9.0 <=0.9.10`, fixed in 0.9.11) and GHSA-c7q8-3ch8-vqpv (`>=0.9.0 <=0.9.11`, fixed only in 0.9.12) — confirmed live against the GitHub Advisory Database. `npm audit` never surfaced any of this (its advisory data doesn't cover these IDs for this package), which is the real severity that finally prompted applying the bump rather than continuing to defer it. Still dev-only and likely-unreachable in practice (this repo has no `ios:` scripts, never runs `cap add ios`), but "low risk to this repo" and "low severity" are different claims — only the first one was ever true.
- **Two content claims flagged in round 8's content-accuracy pass but deliberately NOT auto-corrected**, both near/past the auditing model's own knowledge-cutoff confidence range: `doc-abcp-1`/`doc-abcp-2`'s claimed 7 July 2026 WHtR (waist-to-height ratio) body-composition standard replacing the tape test (specific date/directive/"no sex adjustment" detail unconfirmed), and an unnamed "BRS overview" entry's claimed continuation-pay eligibility window shift (8–12 years → 7–12 years, "as of 1 Jan 2026"). Worth a human subject-matter re-check next time either policy area comes up — do not treat silence here as confirmation either claim is correct.

**Cleared 2026-09-14** (all four items below were verified fixed or already-fixed and removed from this list in the same pass):
- ~~This file's version line/table gap between round 8 and round 9~~ — backfilled into §1's table above (v1.6.0, v1.7.0, GUIDON Flashcard OS, ACFT/AFT module scoping, the Rapid Fire steal mechanic, and the doctrine confidence-field backfill all now have real rows).
- ~~MOI Import's "Not saved" warning being silently unreachable~~ — turned out to already be fixed (a code comment at the fix site cites a live Playwright-confirmed reorder, and `test-moi-import.mjs` already has a passing regression assertion for it); this bullet was simply never removed once the fix landed.
- ~~`G.modal`'s `dialog()` and `WhatsNew.show()` hand-rolling their own Escape/Tab focus-trap~~ — both refactored to share `util.modalTrap`, closing the narrower-Tab-selector gap; full `npm test` green, including `test-whats-new.mjs`'s existing Escape/Got-it coverage.
- ~~DA Form 4856's mode-switch buttons going visually stale after a second toggle~~ — fixed by resyncing both buttons' `classList.active`/`aria-pressed` on every click, same convention Settings' own segmented controls use. New regression coverage in `test-counselpdf-sigmode.mjs` toggles the mode 3 times in the same session and was confirmed to fail against the pre-fix code before being trusted green.

---

## 6. Picking this up in a new session

- Read this file, then the latest `CHANGELOG.md` entry, before starting anything — both exist so a new session doesn't have to re-derive context a prior one already has.
- The parallel-Workflow-agent implementation pattern (§2 above) is the default for any multi-part round, not just roadmap audits — it scales cleanly to this codebase's single-file size, including genuinely concurrent edits to the same giant file, as long as bucket boundaries are drawn so overlaps land in different functions where possible.
- `guidon-app/tools/test-*.mjs` is the real regression suite (`npm test` runs all of it); a targeted subset scoped to whatever a round actually touched is the practical substitute when the full ~150-script battery isn't feasible to run locally — CI's own sharded matrix remains the full, unabridged safety net regardless.
- Update this file's §1 (completed) and §4 (known/low-priority) at the end of any round that changes them — that's the whole maintenance cost of keeping it useful.
