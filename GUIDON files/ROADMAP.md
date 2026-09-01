# GUIDON — Roadmap

**Read this to know: what's shipped, what's deliberately not built (and why), and what actually comes next.** `GUIDON_PROJECT_MAP.md` is the 10,000-foot *what is this app* orientation; `CHANGELOG.md` is the session-by-session *what changed*; this document is the forward-looking one — pull from it to pick up where the last session left off, and keep it current going forward rather than letting it drift the way the other canonical docs already have once.

**Current version:** v1.5.0 (2026-09-01)

---

## 1. Completed initiatives

These are done — not "paused," not "mostly done." Nothing queued against them.

| Initiative | Scope | Where |
|---|---|---|
| Board-card content-accuracy project | All 984 board-question cards independently researched; zero duplicated/faked answer content remains | PRs #86–#88 |
| Enhancement backlog (2-pass full-app audit) | 86 findings across 2 audit passes, every tier (do-first through long-term) implemented | PRs #93, #95, #96, #97 |
| Roadmap-audit cadence, rounds 1–6 | Six 8-lens audit rounds (correctness, a11y, content-accuracy, native-platform, dependencies, test-coverage, performance, UX) | PRs #90–#92, #98, #106, #107 |
| MOI Import Engine, Phase 1 | `#/moi` — import a board MOI, get a matched study dashboard + a disposable practice drill | PR #107 |
| Session-close cleanup | Hyphenated-tier-range filter bug, one mis-filed self-check question, 6 dependency bumps, 2 CI races root-caused (not just re-run) | PR #108 |

See `CHANGELOG.md`'s v1.5.0 entry for the detailed version of all of the above.

---

## 2. The roadmap-audit cadence is a standing practice, not a finished project

Whenever the backlog above is exhausted and someone asks "what's next," the answer is: run another round. This has held for 6 consecutive rounds and has no natural end.

**The pattern**, refined across all 6 rounds:
1. An 8-lens audit (correctness / accessibility / content-accuracy / native-platform / dependency-hygiene / test-coverage / performance / UX-consistency), each lens explicitly primed with everything every prior round already fixed, so it doesn't waste a pass rediscovering settled work.
2. Raw findings synthesized into buckets — before dispatch, manually scan for any file/route mentioned 3+ times across different buckets and consolidate those into one dedicated bucket (cuts merge-conflict risk at the highest-collision area; empirically took one round from 3 manual conflicts to zero).
3. Each bucket implemented by an independent Workflow agent in its own isolated git worktree, all dispatched in parallel.
4. Merged sequentially into one integration branch. A conflict on GUIDON's single-line `window.GUIDON_SEED` blob is common even when the actual edits don't overlap (git can't see sub-line structure) — resolve with a brace-balanced extractor script, never a blind text merge, and always re-verify the resulting seed parses as valid JSON with the expected counts before committing.
5. Headless verification (`npm run build`, `lint:patterns`, a targeted regression batch scoped to what the round touched, the full `verify.mjs` sweep), then PR, then CI.
6. A "confirmed recurring CI flake" is not license to stop looking — two signatures logged as benign flakes across earlier rounds (`rapid-fire-solo-team`, `test-nav-tier2ab`'s new-tab assertions) turned out to be real, fixable timing races once someone actually looked at the mechanism instead of re-running a third time. Treat a signature that keeps recurring as a lead, not a shrug.

**To start the next round**: no ceremony needed — just ask. The same 8 lenses, primed against this file plus the latest `CHANGELOG.md` entry, is the whole kickoff.

---

## 3. Deliberately not built — and why

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

## 4. Known, tracked, low-priority

Small, real items — not urgent, not forgotten.

- **ADP 7-0 self-check category**: audited in full (all 15 items) as of v1.5.0; one genuine mis-file found and fixed. Closed, not open — listed here only so a future pass doesn't re-audit it from scratch without checking this file first.
- **`GUIDON_MASTERFILE.md` and `GUIDON_PROJECT_MAP.md` numbers drift between updates** — both documents say so about themselves. Prefer deriving a figure live (`tools/declared-routes.mjs`, or a direct seed query) over trusting a hand-written count in either document, this one included, if the figure matters for a real decision.

---

## 5. Picking this up in a new session

- Read this file, then the latest `CHANGELOG.md` entry, before starting anything — both exist so a new session doesn't have to re-derive context a prior one already has.
- The parallel-Workflow-agent implementation pattern (§2 above) is the default for any multi-part round, not just roadmap audits — it scales cleanly to this codebase's single-file size, including genuinely concurrent edits to the same giant file, as long as bucket boundaries are drawn so overlaps land in different functions where possible.
- `guidon-app/tools/test-*.mjs` is the real regression suite (`npm test` runs all of it); a targeted subset scoped to whatever a round actually touched is the practical substitute when the full ~150-script battery isn't feasible to run locally — CI's own sharded matrix remains the full, unabridged safety net regardless.
- Update this file's §1 (completed) and §4 (known/low-priority) at the end of any round that changes them — that's the whole maintenance cost of keeping it useful.
