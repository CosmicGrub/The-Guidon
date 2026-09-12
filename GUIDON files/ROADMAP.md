# GUIDON — Roadmap

**Read this to know: what's shipped, what's deliberately not built (and why), and what actually comes next.** `GUIDON_PROJECT_MAP.md` is the 10,000-foot *what is this app* orientation; `CHANGELOG.md` is the session-by-session *what changed*; this document is the forward-looking one — pull from it to pick up where the last session left off, and keep it current going forward rather than letting it drift the way the other canonical docs already have once.

**Current version:** v1.5.1 (released 2026-09-01; round 7's own PR merged to `main` 2026-09-06, round 8 merged the same day — main is ahead of the published release's code by round 8's fixes, no new release cut yet)

---

## 1. Completed initiatives

These are done — not "paused," not "mostly done." Nothing queued against them.

| Initiative | Scope | Where |
|---|---|---|
| Board-card content-accuracy project | All 984 board-question cards independently researched; zero duplicated/faked answer content remains | PRs #86–#88 |
| Enhancement backlog (2-pass full-app audit) | 86 findings across 2 audit passes, every tier (do-first through long-term) implemented | PRs #93, #95, #96, #97 |
| Roadmap-audit cadence, rounds 1–8 | Eight audit rounds — seven full 8-lens sweeps plus round 7 (scoped to fast/small/low-risk fixes only) | PRs #90–#92, #98, #106, #107, #112, #114 |
| MOI Import Engine, Phase 1 | `#/moi` — import a board MOI, get a matched study dashboard + a disposable practice drill | PR #107 |
| Session-close cleanup (round 6) | Hyphenated-tier-range filter bug, one mis-filed self-check question, 6 dependency bumps, 2 CI races root-caused (not just re-run) | PR #108 |
| v1.5.0 release | First tagged GitHub Release — all 4 platform artifacts (standalone, web, Windows, Android), version bump, this document's own creation | v1.5.0 tag |
| Gradle-wrapper regression, caught and fixed live on `main` | A Dependabot major bump broke real Android builds despite passing CI clean (no job actually exercises a real Gradle build); reverted, dependabot.yml now ignores that specific bump | PR #110 |
| Round 7 (quick wins) | A real doctrine error, 2 a11y/UX gaps on `#/moi`, a new icon-registry test closing a real silent-fallback class, a Reminders double-read fix, and 9 test suites (including `test:moi-import` itself) found silently never running in CI, now wired in | PR #112 |
| `cargo check --locked` CI mystery, fully resolved | Two distinct, stacked root causes, each confirmed via direct evidence rather than assumed: (1) CI's Windows runner tracked whatever cargo shipped that week (1.98.0) while `Cargo.lock` had been generated locally by 1.96.0 — fixed with `rust-toolchain.toml` pinning the channel; (2) even after the pin, the *committed* `Cargo.lock`'s own `guidon` package version had silently been left at the pre-bump value while `Cargo.toml` moved on — fixed by committing that one-line diff. A version diagnostic step added to the CI job is what surfaced cause #1 after several blind re-runs. | PR #112 |
| Gradle-wrapper patch bump, verified before merge (not on CI-green alone) | 8.14.3 → 8.14.5, same major line as the reverted 9.7.1 regression above — checksum verified against Gradle's own published SHA256, plus a real `npm run android:debug` build run before merging, precisely because CI's own checks don't exercise a real Gradle build | PR #111 |
| Round 8 (full 8-lens sweep) | 20 real findings, 7 buckets: 3 DST-boundary date-math bugs (Progress heatmap, Leader reminders, Home sparkline), a Land Nav Drill keyboard-focus bug, 4 doctrine self-contradictions fixed against the app's own other content (M4 burst-fire, SGT/SSG semi-centralized promotions + retired-APFT reference, an Article 15 forfeiture-limit error, one last "DA Form 2977"→"DD Form 2977" instance), MOI Import hardened across 4 lenses at once (focus management, `aria-expanded`, confirm-before-discard, save toast, parallelized PDF extraction, new test coverage), 3 native-platform cleanups (an unused Android permission, a dead push-notification stub, a stale comment), 2 destructive Forms/POA "Clear" buttons gated to match the app's own confirm convention, and a genuine feature regression caught by bucket G's own test-coverage work (the Essay Drill → Doctrine cross-link had been left behind on an orphaned branch during round 6's merge and never actually reached `main` — restored, with real test coverage this time) | PR #114 |

See `CHANGELOG.md`'s v1.5.0, v1.5.1, and round-8 entries for the detailed version of all of the above.

---

## 2. The roadmap-audit cadence is a standing practice, not a finished project

Whenever the backlog above is exhausted and someone asks "what's next," the answer is: run another round. This has held for 8 consecutive rounds and has no natural end.

**The pattern**, refined across all 8 rounds:
1. An 8-lens audit (correctness / accessibility / content-accuracy / native-platform / dependency-hygiene / test-coverage / performance / UX-consistency), each lens explicitly primed with everything every prior round already fixed, so it doesn't waste a pass rediscovering settled work.
2. Raw findings synthesized into buckets — before dispatch, manually scan for any file/route mentioned 3+ times across different buckets and consolidate those into one dedicated bucket (cuts merge-conflict risk at the highest-collision area; empirically took one round from 3 manual conflicts to zero).
3. Each bucket implemented by an independent Workflow agent in its own isolated git worktree, all dispatched in parallel.
4. Merged sequentially into one integration branch. A conflict on GUIDON's single-line `window.GUIDON_SEED` blob is common even when the actual edits don't overlap (git can't see sub-line structure) — resolve with a brace-balanced extractor script, never a blind text merge, and always re-verify the resulting seed parses as valid JSON with the expected counts before committing.
5. Headless verification (`npm run build`, `lint:patterns`, a targeted regression batch scoped to what the round touched, the full `verify.mjs` sweep), then PR, then CI.
6. A "confirmed recurring CI flake" is not license to stop looking — two signatures logged as benign flakes across earlier rounds (`rapid-fire-solo-team`, `test-nav-tier2ab`'s new-tab assertions) turned out to be real, fixable timing races once someone actually looked at the mechanism instead of re-running a third time. Treat a signature that keeps recurring as a lead, not a shrug.
7. A real-condition poll (`page.waitForFunction`) can still fail under CI's worst contention if its *patience* is too tight — that's a different bug from the original "used a fixed wait instead of a real condition" class. Round 8 found `rapid-fire-solo-team`'s already-correct poll (fixed in round 6) timing out at 5000ms specifically on the FIRST call in a run, right after fresh page boot under an 8-concurrent-Chromium chunk; every later call in the same run passed in under a second. Fix was to widen the timeout (5000ms→15000ms) on the same correct mechanism, not to add a new fixed wait — confirmed via the CI log which call actually timed out before touching anything.

**To start the next round**: no ceremony needed — just ask. The same 8 lenses, primed against this file plus the latest `CHANGELOG.md` entry, is the whole kickoff.

---

## 3. Next up: Content & Educational Materials expansion (design doc, not started)

A full design-and-pitch document exists at
`guidon-app/docs/design/content-education-roadmap.md` (written 2026-09-10/11)
proposing four connected additions: a Physical Readiness Training module
(`#/prt`, the Preparation Drill's 10 exercises — already present as prose
in the seed today, but with no dedicated feature), a Creeds & Branch
Identities reading pillar (`#/creeds` — an audit found 3 of the requested
creeds already exist verbatim as `board.questions` rows, but 11 of 15
requested branch/unit identities, including every combat-arms and
sustainment branch motto, do not exist in any form today), a recitation
study-tools module (`#/recite` — first-letter mnemonics, chunking/
backwards-chaining, timed recitation, all built on existing SRS/timer
plumbing with no new engine), and the Global Search/nav/citation wiring to
make all of it findable. **Nothing in it is implemented** — no route or
seed key it names exists in `src/index.html` yet. One real, confirmed
blocker before the PRT module's per-exercise detail can ship: ATP 7-22.02
(the actual exercise-by-exercise PRT manual FM 7-22 defers to) is not yet
in `guidon-app/docs-source/` and needs to be acquired first; every other
piece of this initiative is unblocked. Read that document for the full
architecture, phased milestones, and open decisions before starting any of
this work.

---

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
- **`@xmldom/xmldom` 0.9.10→0.9.12** (dev-only, via `@capacitor/cli`→`plist`; GHSA-6gmq-8vp8-gcm6) — likely-unreachable in practice (this repo has no `ios:` scripts, never runs `cap add ios`), zero-risk, free lockfile-only bump (`plist` already allows `^0.9.10`). Not yet applied — low urgency, listed here so it isn't lost.
- **Two content claims flagged in round 8's content-accuracy pass but deliberately NOT auto-corrected**, both near/past the auditing model's own knowledge-cutoff confidence range: `doc-abcp-1`/`doc-abcp-2`'s claimed 7 July 2026 WHtR (waist-to-height ratio) body-composition standard replacing the tape test (specific date/directive/"no sex adjustment" detail unconfirmed), and an unnamed "BRS overview" entry's claimed continuation-pay eligibility window shift (8–12 years → 7–12 years, "as of 1 Jan 2026"). Worth a human subject-matter re-check next time either policy area comes up — do not treat silence here as confirmation either claim is correct.
- **MOI Import's "Not saved" warning is silently unreachable** (found during round 8's bucket A work, not one of that bucket's assigned fixes): `build()`'s warning text is appended to `stage` and then immediately wiped by `renderAlreadyImported()`'s own clear, so a Soldier never actually sees it. Spun off as its own follow-up task rather than expanding round 8's scope — check whether it's been picked up before re-flagging.

---

## 6. Picking this up in a new session

- Read this file, then the latest `CHANGELOG.md` entry, before starting anything — both exist so a new session doesn't have to re-derive context a prior one already has.
- The parallel-Workflow-agent implementation pattern (§2 above) is the default for any multi-part round, not just roadmap audits — it scales cleanly to this codebase's single-file size, including genuinely concurrent edits to the same giant file, as long as bucket boundaries are drawn so overlaps land in different functions where possible.
- `guidon-app/tools/test-*.mjs` is the real regression suite (`npm test` runs all of it); a targeted subset scoped to whatever a round actually touched is the practical substitute when the full ~150-script battery isn't feasible to run locally — CI's own sharded matrix remains the full, unabridged safety net regardless.
- Update this file's §1 (completed) and §4 (known/low-priority) at the end of any round that changes them — that's the whole maintenance cost of keeping it useful.
