# Changelog

All notable changes to GUIDON will be documented in this file. Format loosely follows [Keep a Changelog](http://keepachangelog.com/).

## 2026-08-08 (session 53, continued) - v1.4.7: three research-backed checks — one real fix, two honest non-fixes

**Ask (continued):** the remaining items from the systematic open-items list — civilian-education per-semester-hour rate, the 2021-DoD-baseline acronyms dictionary, and the MOS Career Center's FY26 shortage/SRB data.

**Civilian-education rate: investigated, deliberately left unchanged.** Five research attempts (2 WebSearch, 3 WebFetch — including the actual DA Form 3355 PDF and an attempted DA Pam 600-25 fetch that hit a 403 on api.army.mil) found a genuine, unresolved conflict: one source states 1 point per semester hour with explicit conversion ratios, another states 2 points per semester hour, both citing the same regulation. DA Form 3355 confirms the app's existing 135/160 SGT/SSG caps but doesn't print the per-hour rate itself — that lives in DA Pam 600-25's narrative text, which could not be fetched cleanly from any source this session. Did not implement a computed field on a coin-flip between two conflicting numbers for a real points calculator. The existing direct-entry field (a prior session's own honest "not verified, does not guess it" design) was already correct; strengthened its disclaimer to name the specific conflict found.

**Acronyms dictionary: internal sweep clean, external diff blocked by tooling.** Full verification of 3,629 entries against the current DoD Dictionary is its own dedicated effort regardless of tooling. What this session did: confirmed the fitness-test-related staleness this concern was originally about was already caught by the same session's ACFT audit; ran a systematic sweep of every definition for known staleness patterns (years 2015–2024, dollar amounts, IPPS-A references, explicit currency claims) and found nothing further; located a genuinely newer DoD Dictionary edition (June 2025, vs. the app's 2021 baseline) but couldn't extract readable text from it — the sandbox is missing `pdftoppm`/poppler-utils, a tooling gap, not a document problem. The working URL is on record in `GUIDON_STATE.json` so the next attempt doesn't start from zero.

**MOS Career Center FY26 data: expected stale, found mostly accurate.** Went in assuming the section's specific citations (HQDA EXORD 117-26, SRB MILPER 26-241) might be the kind of plausible-sounding fabricated regulation numbers LLM-generated content sometimes produces. Research found the opposite — both are real, current documents on the official `api.army.mil` host, one dated July 2026, weeks before this session. The shortage-MOS list and overstrength direction both corroborated against independent research. One real error found and fixed: the SRB note conflated the $180,000 per-award maximum with a "combined-career cap," when the evidence (two independent searches) indicates those are different figures — a separate, higher lifetime cap that couldn't be independently confirmed against primary text (same `api.army.mil` 403 pattern as the civilian-ed research). Reworded to state only what's confirmed and explicitly flag the unconfirmed figure rather than assert a number with false confidence.

**Verified:** full 27-suite `npm test` (0 fail) after each change. v1.4.7 across index.html/package.json/tauri.conf.json/Android (versionCode 10407).

## 2026-08-08 (session 53) - v1.4.6: the ACFT audit that session 42 measured but never finished

**Ask (continued):** work through the ACFT reference audit from `openItems` - 173 live occurrences of "ACFT" across the seed corpus, unclassified since session 42 flagged the count and explicitly deferred the contextual pass ("a regex cannot separate a current-standard claim from a historical one").

**Method:** extracted every string field in `GUIDON_SEED` containing "ACFT" (159 fields, 104 distinct records after collapsing mirrored fields like `a`/`acceptableAnswer`/`boardAnswer`/`keyPoints`), delegated the first-pass classification to a sub-agent against an explicit rubric (fine-historical / fine-neutral / stale-claim / needs-regulation-check), then personally spot-verified a sample against the raw source before acting on any of it - this is board-exam and counseling-template content, wrong here is worse than untouched.

**69 of 104 records were presenting a retired test as current.** The Army Fitness Test (AFT) replaced the ACFT effective 1 June 2025 - over a year before this session - but 69 records (board-question answers, curriculum lessons, IDP goal templates, counseling-bullet templates, five training scenarios' dialogue and narration) still named "the ACFT" in present tense with zero historical framing: a Soldier's counseling template citing "a passing score on the record ACFT," a scenario telling the player "you just failed the ACFT," a goal template reading "Achieve a target ACFT score." Fixed all 69 with a verified, occurrence-counted patch (99 field-level replacements - some records mirror the same text across multiple fields) rather than a blind regex: every replacement checked its expected match count before writing, and the script aborted with nothing written if any count was wrong.

**One fix surfaced a second, independent bug**: `doctrine.entries[200]` ("ACFT Alternate Aerobic Events," sourced `asOf: 2022`, marked `confidence: verified`) listed the *old* ACFT's alternate aerobic events - 5,000m Row, 12km Bike, 800yd Swim - while `board.questions[868]` and `[980]` elsewhere in this same corpus already correctly stated the *current* AFT's alternates as 2.5-Mile Walk, 800-Yard Swim, 6.2-Mile Bike. The app was answering the same board question two different ways depending which page you were on - the exact self-contradiction pattern session 42 found with the taping exemption. Corrected the event list and retitled the entry.

**The app's own transition-tracker entry was itself stale.** `doctrine.entries[35]`, titled "IN TRANSITION: ACFT → Army Fitness Test (AFT)" with `confidence: "in_transition"`, still described the changeover as in-progress - accurate when written, over a year stale by this session. Retitled to reflect the transition as complete and flipped confidence to `verified`.

**Two items deliberately left untouched.** `board.questions[59]` and `[311]` paraphrase AR 600-8-2 and AR 601-280's disqualifying-condition lists, which name "APFT/ACFT failure" among several unrelated triggers. Whether the current (post-2025) revision of either regulation has actually been updated to say AFT could not be confirmed - a WebSearch and a WebFetch against the live armypubs.army.mil AR 600-8-2 PDF both came back inconclusive (the PDF fetch failed to extract clean text; no source directly quoted the current regulation's exact wording). Editing board-exam-answer content on a guess is worse than leaving it stale, per the bucket-4 rule the triage was built around. Flagged in `GUIDON_STATE.json` for a human/SME check against the actual current regulation text.

**Verified:** full 27-suite `npm test` (0 fail), the seed re-parses cleanly (all 17 top-level sections, 1,014/3,629/336/163/182 record counts unchanged - only text values changed, no records added or removed), and `test-consistency.mjs`'s existing fitness-currency assertions (no card teaches six events, no card lists SPT/Leg Tuck as current, no card gives 360 as the current minimum) all still pass, now for real content reasons rather than by omission. v1.4.6 across index.html/package.json/tauri.conf.json/Android (versionCode 10406).

## 2026-08-07 (session 52) - v1.4.5: the first full 24×35 contrast sweep, and native dialogs finally retired

**Ask:** work systematically through the project's own standing open items (contrast near-misses, ACFT audit, etc.), then a follow-up ask to make the UI more responsive and cleaner using real design tooling rather than more blind CSS review.

**The "~104 remaining near-misses" open item was stale and misleading.** It traced to session 15 (2026-07-15); session 19, four sessions later, had already driven that exact theme set to zero, and nothing since had re-derived a real number - every subsequent session quoted or half-quoted the old figure instead of re-measuring. `tools/test-contrast.mjs` itself only ever swept a curated set of previously-bitten components (home/train probe, board, search, settings) - never the full 24-theme × 35-route surface. Built `tools/test-contrast-full.mjs`: a real axe-core `color-contrast` sweep of every route in every theme (840 combinations), checked in for good so this number is never quoted from memory again (`npm run test:contrast-full`).

**First real run found 84 genuine violations, all four root causes previously-unaudited.** (1) 60 of the 84 - the whole Kiosk mode-picker card - were a native `<button>` UA-stylesheet quirk: `<button>` gets its own explicit `color`, not `inherit`, so any custom button that doesn't set its own text color (unlike every `.btn`/`.nav button` in the app, which all do) silently falls back to the browser's default instead of the theme's `--text` token. Fixed with a single scoped `button { color: inherit; }` reset - not paired with the usual `font: inherit`, since every styled button already sets its own font and touching it app-wide wasn't a risk this fix needed to take. (2-4) `.fin-match-tbl th` (Money's TSP match table), `.wr-anat-part` (Write's anatomy chips), and `.res-url` (Resources card links) each used a raw accent (`--amber`/`--cyan`) as direct text color - the same failure mode `--ink-*` exists for, fixed the same way v1.4.4 fixed `.fin-h`: switched to `var(--text)`/`var(--text-dim)` rather than gambling on an accent blend not yet verified against all 24 themes. Re-swept: 0/840 violations.

**Native `confirm()`/`prompt()` retired app-wide.** `GUIDON_DESIGN_SYSTEM.md` had flagged this as open debt since session 30 ("Account panel uses them; unthemed and poor on mobile") on the assumption it was still widespread; in fact the themed, accessible `G.modal` (built session ~44, keyboard-trapped, Escape/Enter, danger styling) had already replaced most call sites - only 8 remained, none in Account: board-drill schedule reset, progress reset, scenario delete, backup import, and three Money worksheet "Clear all" buttons. All converted, danger-styled where destructive, live-tested end-to-end (modal opens, cancel/Escape/accept all confirmed working, real actions fire, toasts confirm). Zero native browser dialogs remain in the app (`alert()` was already absent).

**Verified:** full 27-suite `npm test` (0 fail) plus the new 840-combination contrast sweep (0 violations), plus live interactive verification of every converted dialog via scripted browser automation (open/cancel/Escape/accept, danger styling, real side-effects, toast confirmation). No console errors. v1.4.5 across index.html/package.json/tauri.conf.json/Android (versionCode 10405); releases/v1.4.5 supersedes v1.4.4.

## 2026-08-03/04 (session 51) - v1.4.4: a 49-agent audit finds nine real contrast bugs and a test-infrastructure bug

**Ask (continued):** with both physical devices briefly disconnected, run a broader parallel audit - narrow-viewport truncation across every route, theme/route legibility beyond what the contrast suite already covers, and a source-hardening review of everything touched this session - then verify, fix, and ship, all the way through phone, tablet, and PC.

**Method:** a 3-phase workflow (49 agents total) fanned out a truncation sweep across all 35 routes at the Fold's exact 344px width, a WCAG legibility sweep across 8 routes x 6 themes never touched by `test-contrast.mjs` (Search, Settings, Records, Calendar, Profile, Doctrine, Currency, Leader), and a source review of every piece of code added this session (icons.js, the SRS bridge, the `gi` shorthand, `.ob-wrap`, and the two new suites) - then adversarially re-verified every candidate finding independently before anything got touched.

**Nine real contrast bugs, one root cause.** All nine live on `#/search`'s category filter chips and `#/settings`' `.fin-h` heading: raw `var(--cyan)`/`var(--violet)`/`var(--red)`/`var(--amber)` used as direct text color, failing 4.5:1/3:1 on light themes (2.74-3.55:1 measured). The codebase already has an `--ink-*` color-mix system built specifically for "raw accent as text color" (its own comment names this exact failure mode) - these two spots just never got migrated to it. Fixing the search chips surfaced a second, worse bug underneath: the active chip's background was a literal `rgba(255,176,32,...)` assuming amber is always orange - wrong in `squadron-blue`, which reassigns `--amber` to blue, collapsing text-on-background to 1.01:1 (effectively invisible, the same shape of bug as the forms-button fix in v1.4.0). Both fixed; a 24-theme sweep of the active chip now passes clean. `.fin-h` almost went a different way: `--ink-cyan` traded the light-theme failure for a *worse* dark-theme one (as low as 1.31:1) - the ink blend had only ever been reasoned about for warm/light themes, never verified against all 24. It's a structural label, not a color-coded semantic, so it now uses plain `var(--text)` - the one token every other guaranteed-legible surface already relies on.

**A bug in the audit tooling itself, caught before it shipped a wrong fix.** Verifying `.fin-h` at `var(--text)` reported near-1:1 failures across a dozen dark themes - impossible by construction, since `var(--text)` is the app's primary guaranteed-readable token. Root cause: `test-contrast.mjs`'s background-detection helper unconditionally appended a manufactured white fallback candidate even when it had already found the real (correctly dark) gradient background, so light text got checked against a background that was never actually rendered. Fixed to only fall back when nothing real was found at all - re-running then showed the true (and correct) result: `.fin-h` at `var(--text)` was fine all along.

**Two test-quality gaps closed.** `test-bridge.mjs`'s quiz-miss check counted total SRS keys, which would still print PASS if the bridge call site broke entirely (a miss re-hitting an already-recorded id looks identical to "no write happened" by that logic) - rewritten to spy on `G.board.noteExternalResult` directly and assert on the recorded calls. `test-responsive.mjs` used `!s.truncated`, which treats a missing selector (`null`) as a pass - tightened to strict `=== false`.

**Hardening pass, mostly clean.** `icons.js`, the SRS bridge, and the `gi` shorthand all reviewed with no reachable defect (every dynamic input traced back to fixed, developer-authored config, never runtime data). One real gap: `.ob-wrap` had gotten a bottom safe-area fix in v1.4.3 but not a top one - the onboarding overlay could render partly under a status bar/notch on an installed PWA. Fixed with the same `max(20px, env(safe-area-inset-top))` idiom already used elsewhere. The topbar subtitle ("LEADER DEVELOPMENT · E1-E9") was re-flagged as silently dropping the grade-range text below ~375px with zero affordance - a real content-loss concern distinct from the wordmark bug already fixed in v1.4.2 - now wraps instead of ellipsis-truncating.

**`test-contrast.mjs` gained real coverage**, not just fixes: it never rendered `#/search` or `#/settings` before this session at all. Both are swept now, 24 themes each.

**Verified:** sixteen suites, still zero failures, plus the new Search/Settings contrast coverage. v1.4.4 across all forks (Android 10404); releases/v1.4.4 supersedes v1.4.3.

## 2026-08-03 (session 50, continued) - v1.4.3: the onboarding screen clears the system nav bar

**Ask (continued):** the same hands-on device pass that found the topbar bug also surfaced a second, softer issue on the same first screenshot - it just took a second look to size it up correctly.

**The finding:** the onboarding screen's third mode card ("Kiosk / Demo Mode") rendered with its description text partially behind the Fold's translucent 3-button system nav bar in the initial (unscrolled) view. Unlike the topbar bug, this was never actually inaccessible - scrolling reveals all three cards in full - but there was no visual cue that scrolling would help, and a card ending mid-sentence behind a system bar reads as broken on first glance.

**Root cause:** `.ob-wrap`'s bottom padding was a fixed 40px, sized for normal breathing room but never intended to also clear a translucent system bar. `.main` and the nav rail already solved this identical problem with `padding-bottom: calc(Npx + env(safe-area-inset-bottom))` - additive, not `max()`, because the view needs both the visual margin and the system-bar clearance, not whichever happens to be larger. Applied the same idiom to `.ob-wrap`.

**Verified:** sixteen suites, 179 assertions, still zero failures - no suite specifically pins onboarding-bottom-padding, but nothing regressed. v1.4.3 across all forks (Android 10403); releases/v1.4.3 supersedes v1.4.2; reinstalled on both devices.

## 2026-08-03 (session 50) - v1.4.2: hands-on device audit finds the topbar's real narrow-phone bug

**Ask:** photograph the app actually running on both physical devices (Tab S9 FE, Galaxy Z Fold 5), annotate real deficiencies, audit further, repair, roll into the build/GitHub, and restore parity everywhere.

**Method:** launched GUIDON on both devices via adb, drove it with real taps/swipes (uiautomator dumps for exact element bounds rather than guessing pixel coordinates from screenshots), and read back screenshots at each step - Home, Board Prep, the flashcard, the grade buttons - on the Tab's 2304px landscape and the Fold's 344px folded cover screen, the narrowest real viewport this app runs on.

**One real, confirmed bug:** the topbar wordmark truncated to "GUI..." and "LEADER D..." on the Fold's cover screen. The accessible name was correct (screen readers heard "GUIDON" in full) - this was pure CSS clipping, caused by the fixed-width "Online" status chip leaving too little room once combined with the search/profile buttons. `#topbar-username` already had a `max-width:480px` hide rule for exactly this phone-chrome budget problem; the status chip did not. Fixed by extending that same rule. Verified at 344/360/412/481/1440px with a new suite, test-responsive.mjs (16) - the wordmark never clips, the chip disappears exactly at the breakpoint and nowhere else.

**One false alarm caught before it became a wasted "fix":** the Board Prep tab strip appeared to hard-clip "MOCK BOARD" with no indication more tabs existed. Zooming into the screenshot pixel-for-pixel showed a genuine soft fade already applying - a prior session (§41) had solved exactly this on exactly this device, down to a code comment naming the 344px Z Fold scenario, and test-scrollhint.mjs already pins it. No change made. Worth recording: a screenshot glanced at quickly can look like a hard clip when it is actually a working, subtle affordance - zoom in before "fixing" what already works.

**Confirmed clean on real hardware:** the flashcard, star toggle, all four grade buttons, and the full nav row (prev/flip/next/fullscreen) render correctly at the Fold's extreme 344px width - the icon system from v1.4.0 holds up under the narrowest real device this app targets, not just Playwright's synthetic viewports.

**Verified:** sixteen suites, 179 assertions, zero failures. v1.4.2 across all forks (Android 10402); releases/v1.4.2 supersedes v1.4.1. Reinstalled on both the Tab and the Fold via adb.

## 2026-08-03 (session 49, overnight block) - v1.4.1: Quiz/Mock Board now feed the drill's memory model

**Ask (standing):** with the icon/legibility work shipped, continue the recorded follow-up backlog inside a one-hour window.

**The SRS bridge** - the follow-up the state file has carried since session 17 ("extending 4-level grading to Quiz Mode/Mock Board"). `G.board.noteExternalResult(id, grade)` closes over the drill's own `schedule()`/`saveSrs()` - one scheduler, one store, no drift. Direction is deliberate: Mock Board is real recall (answered aloud, self-judged), so it moves cards both ways - Missed->Needs Help, Partial->Somewhat, Nailed->Know It (never Down Cold; the top grade stays an explicit claim made on the card). The multiple-choice quiz is only recognition, so it can DEMOTE (a miss or timeout makes the card due now) but never advance. The quiz results screen says so out loud. New test-bridge.mjs (suite 15) asserts the API semantics and drives a real quiz click through the bridge.

**MOS Career Center cross-links** (section-7 follow-up #4): the profile header's MOS now links to `#/career`, and the Transition Career tab - which is post-ETS civilian pathways - offers the staying-in path (reclass, shortage MOSs, warrant packets) at the top.

**Verified:** fifteen suites all passing. v1.4.1 across all forks (Android 10401); releases/v1.4.1 supersedes v1.4.0 (30 minutes old, never installed on any device - artifacts remain in git history).

## 2026-08-03 (session 49) - v1.4.0: the icon system, and legibility proven across all 24 themes

**Ask:** audit the layout and replace every placeholder glyph with genuine icons - premium and dynamic without breaking any theme - and fix training scenarios that rendered dark (unreadable) regardless of theme; guarantee all text is legible under every theme.

**The icon system (G.icons).** ~50 stroke icons in the Feather idiom - 24x24 grid, 2px stroke, round caps - drawn in `currentColor`, so an icon is exactly as legible as the text beside it in all 24 themes by construction. No font, no sprite, no network: geometry lives in icons.js and the build inlines it into every fork. A `gi:` prop on util.el() became the one-line upgrade path: `{ gi: "printer", text: "Print plan" }`. 111 call sites converted - nav rail + group chevrons, topbar search/profile, hero quick-nav, the whole Board Drill control surface (star, shuffle, prev/flip/next, theater toggle, grade buttons), print/export/import/replay buttons, warning panels, scene tags, source citations, expander chevrons (now rotating in place via CSS keyed off aria-expanded, replacing textContent swaps that would have wiped the svg). Two traps caught by design: syncFsBtns and the timer/star/due-chip relabels previously wrote textContent, which would have silently destroyed icon children - all now replaceChildren with the icon rebuilt.

**The dark-scenario bug, at the root.** Train's text-console was `background:#06090c` and the CYOA scene banner a hardcoded near-black gradient - fine in dark themes, unreadable in the five light ones. Both now derive from tokens: the console tints `--text` 7% into `--bg` (terminal feel in dark themes, warm paper-gray in light ones), the banner mixes `--cyan`/`--amber` washes over `--panel`.

**Legibility is now a test, not a claim.** New test-contrast.mjs (suite 14) walks all 24 themes and measures real WCAG ratios on the Train console, CYOA banner label, forms/primary/nav/topbar controls, dim text, board card and grade labels - steady-state, after killing the theme crossfade (getComputedStyle mid-transition returns interpolated oklab values; the suite's own first run produced 67 phantom failures before that was understood). It then caught two real shipped bugs: `.forms-view .btn.primary` recolored text amber but left the amber background - 1.0:1, literally invisible, in every theme - and the console's cyan system line at 2.58-2.77:1 on four light themes. Both fixed with token mixes; sweep now passes 24 themes x 12 surfaces clean.

**Verified:** fourteen suites all passing. Version 1.4.0 across app constant, package.json, Tauri and Android (10400); releases/v1.4.0 for every fork with fresh checksums.

## 2026-08-02 (session 48) - v1.3.0: fullscreen study (theater mode) for the Board Drill

**Ask:** a YouTube-style fullscreen toggle on the study cards - card fills the screen, nothing else competing for attention. Build, push, deploy to every fork and the connected tablet.

**Design:** the guaranteed layer is CSS - html.qz-theater turns the card wrap into a fixed overlay painted with the app's own --bg token, COVERING the topbar/nav/filters rather than hiding them. An opaque cover needs no knowledge of what is underneath, so it is correct in all 24 themes and identical on file://, hosted, Windows and Android. The Fullscreen API and Android immersive status bar (G.native.setImmersive) are progressive enhancement; where a runtime lacks them the CSS alone still delivers. The study loop stays visible - card, flip/prev/next, grade buttons, star - because it is the point, not a distraction.

**Exits, all of them, one escape each:** the toggle button; Escape (document-level, wired once); system fullscreen exit (fullscreenchange sync); Android Back (closeTopLayer peels theater first); navigation (route() exits - a fixed overlay must never outlive its view). Grading advances cards WITHOUT leaving theater. One stacking bug caught pre-ship: toasts are z-index 50 vs the 800 overlay, so grade feedback would have vanished in fullscreen - lifted to 900 while theater is active.

**Flip animation made fluid, and adjustable via the existing Motion setting.** The real culprit was a drag bug: every touchmove updated the card's transform while the stylesheet's 0.5s flip transition was still active, so a swiped card chased the finger half a second behind. The transition is now killed on the first drag movement and restored when the drag settles. The flip itself now answers to Settings -> Motion instead of one hardcoded curve: standard 0.45s crisp stop, rich 0.65s with a slight settle past 180 degrees (the default - a card flicked, not cranked), cinematic 0.95s deliberate; minimal/reduce-motion keep the instant face swap. Perspective deepened 1400 -> 1150px, and the card is layer-promoted (will-change) so the first flip's opening frames do not stutter on rasterization. New test-flip.mjs, 13 assertions incl. dispatched-touch drag; thirteen suites total.

**Sizing refined on the real tablet:** the first cut capped the card at 920px x 66vh, which on the Tab S9 FE in landscape left a third of the screen as empty margin. The card now flex-fills all leftover height - measured coverage went from 70%x65% to 97%x83% landscape, 97%x91% portrait, 96%x89% phone - with no per-viewport tuning.

**Verified:** new test-theater.mjs, 14 assertions including a topbar hit-test, in-theater flip/grade/advance, and navigation cleanup. Twelve suites, all passing. Version 1.3.0 across app constant, package.json, Tauri, Cargo and Android (10300); releases/v1.3.0 with fresh checksums. The stale device watcher that would have installed 1.2.0 on the Fold's reconnect was killed and re-armed for 1.3.0.

## 2026-08-02 (session 47) - Production UX pass: three shipped bugs and the first-run experience

**Ask:** tighten UX/UI toward production quality, with 1:1 parity across every platform fork.

A 48-shot screenshot matrix (14 sections x 3 real viewports) drove the pass, and its own failures exposed two shipped bugs before any review happened:

1. **First-visit reload.** The service worker's clients.claim() fired controllerchange ~2s after a hosted first load and pwa.js reloaded the page - right as a first-time user tapped an onboarding card. Reload now applies only to genuine updates, never the first claim.
2. **Navigation landed mid-page.** Session 49's scrollhint called scrollIntoView() on the active tab, which scrolls every ancestor INCLUDING THE PAGE to reach a strip low in the view - so arriving at Settings landed halfway down. Now horizontal-only via the strip's own scrollLeft.
3. **Home rendered twice at boot.** app.start() sets the default hash AND calls route(); the hash-set fires a second route(); two async renders interleave and both append. Latent on rapid nav taps too. Fix: every render gets its own frame, so a superseded render appends into a detached node. Verified on boot and a 10ms double-nav.

**First-run experience rewritten from evidence.** A new user's Home led with a bare mm/dd/yyyy SET strip, then "1014 board cards due for review - large backlog" in red (a card with no SRS record is "due", so day one = the whole deck), then a red ACTION REQUIRED alert - all before the hero. Now: hero first; a never-graded deck reads "1,014 board cards ready to study - start with 20 and the schedule builds itself"; the training panel is neutral until someone has actually started; role=alert became role=status; and "Welcome back, KIOSK MODE." no longer greets placeholder names.

**Settings halved.** The 24-theme wall is now one summary row (current theme + Change theme) expanding on demand - verified collapsed/expand/switch/summary-tracking. The tier filter label no longer contradicts E1-E9 branding (display only; the functional key untouched).

**Housekeeping:** C: hit 0 bytes free mid-pass - my two emulator AVDs (9.9 GB) plus a still-running headless qemu holding RAM images. Deleted and killed; ~10 GB recovered; device testing lives on the real Fold 5 and Tab S9 FE now.

**Verified:** eleven suites, zero warnings. All forks rebuilt from the same source; parity proven per-fork by the standalone file://, web, and desktop-CSP suites.

## 2026-08-01 (session 46) - Flows 2 and 3 walked with NVDA

**Ask:** walk flows 2 and 3 with the screen reader and report back.

Done. Windows toasts were suppressed for the run (they had been stealing foreground focus) and restored afterwards; the walk moved to a real Chrome window driven by Playwright, since NVDA reads Chromium natively and precise focus beats blind tabbing.

**One genuine defect: navigating to Forms announced NOTHING.** `#/forms` rendered its title as bare text in a `<div class="section-title">` while every other view wraps it in an `<h2>`. The router focuses "h1, h2" inside #route after each render to announce the new view; with no heading it found nothing, focus never moved, and arriving at Forms was completely silent. Every automated check passed it - the topbar h1 satisfied "exactly one level-1 heading", and a MISSING h2 is not a heading-level SKIP. Fixed, confirmed with NVDA, and test-a11y-tree.mjs now asserts every view has a heading the router can focus (all 35 pass).

**Both flows otherwise read well.** Board Prep: heading level 2, then the card question, then "Answer revealed." on Space, then "Marked known. Next card." on grade 3. The flipped card announces with real structure - "Answer content, scrollable | region", acceptable and verbatim answers, "KEY POINTS | list", then the four grade buttons and "Star this card | toggle button | not pressed". Forms: heading, then each form with its full description and source reference.

**Four findings that were the harness, not the app** - three of which looked serious:
1. NVDA reading the whole Settings page. Did not reproduce under clean navigation; the first walk matched ".nav button" by text and hit the COLLAPSIBLE GROUP HEADERS, which expand a group rather than navigate.
2. A corrupted form description. The string is perfect - NVDA logs Python-repr style and switches to DOUBLE quotes when a string contains an apostrophe, so a single-quote parser split "the leader's tool" mid-word.
3. "Grading a card announces nothing." It announces correctly. Selectors used `#view`, which does not exist - the container is `#route`, so focus never landed on the card.
4. The answer announced twice - same focus churn as (1).

Four apparent defects, three of them mine. Each was checked before being reported; fixing any on first appearance would have damaged working code.

**Verified:** 35 sections, eleven suites all passing. Desktop, APK/AAB and standalone rebuilt.

**The tally:** across sessions 45 and 46 a real screen reader found TWO genuine defects - the #route live region reading whole pages aloud, and Forms announcing nothing on arrival - both invisible to axe-core, to the keyboard audit, and to the accessibility-tree audit written specifically to find accessibility defects. It also produced four false alarms, every one a fault in the instrument. That ratio is the honest picture of screen-reader testing: it finds what nothing else can, and it lies to you constantly.

## 2026-08-01 (session 45) - NVDA, and the bug only a screen reader could find

**Ask:** install NVDA and walk three flows - onboarding, a Board Drill card, a DA 4856 export.

**`#route` - the entire main view container - carried `aria-live="polite"`.** Every navigation pushed the whole rendered section into a polite live region, so NVDA read the COMPLETE PAGE ALOUD. On the doctrine corpus or the 3,629-term dictionary that is thousands of words of unstoppable speech on every route change. The app was effectively unusable with a screen reader and had been for its entire history.

Before the fix the transcript is one continuous run: "BOARD PREP BOARD DATE Month Set your board date /Day ... Tap a card (or press Space) to flip it. Grade yourself 1-4 ..." through the whole view. After, the same keystrokes give discrete output: main landmark, then Quick navigation grouping, then button TRAIN, then heading level 2.

**Three things should have caught it and none did.** axe-core: aria-live on a container is valid markup, so zero violations, correctly. Session 38's keyboard audit checked focus order and landmarks, and a live region is neither. Session 50's accessibility-tree audit counted the region's EXISTENCE as a PASS - it endorsed the bug.

Route changes were already announced correctly by focusing the view heading. The live region was redundant AND harmful. test-a11y-tree.mjs now fails any live region that wraps a view - contains a heading, over 400 characters, or more than three children.

**How it was run:** NVDA 2026.1.1 from nvaccess.org, Authenticode-verified as NV Access Limited before executing, configured with the silence synthesizer (no audio) and loggingLevel=DEBUG, which still logs every speech sequence. tools/nvda-drive.ps1 focuses the app, sends keystrokes and extracts them.

**Only flow 1 was completed.** Flows 2 and 3 were repeatedly broken by Windows notifications from this agent's own tooling stealing foreground focus mid-run. That is an environment problem, not an app problem. NVDA is installed and configured; walking those two by hand with audio on takes about five minutes and is a better test than any harness.

**Four self-inflicted faults:** a portable NVDA copy that silently refused to start (hand-written nvda.ini used schemaVersion 13; the real value is 22), an ini patch that moved schemaVersion inside [general] where it is invalid, a transcript path with doubled backslashes, and a line-based edit that split on a newline an earlier bug had introduced.

**Verified:** 35 sections, eleven suites all passing. Desktop, APK/AAB and standalone rebuilt after the fix.

**The lesson:** session 50 narrowed the screen-reader gap with the computed accessibility tree and said honestly it "cannot tell you whether the experience is usable". That caveat was not boilerplate. The single worst accessibility defect in this app was invisible to every automated check - including the one written specifically to find accessibility defects - and took about twenty minutes of a real screen reader to expose.

## 2026-07-26 (session 44) - The screen-reader gap, narrowed

**Ask:** continue onward.

**Section 37 named screen-reader usability the project's biggest unknown; section 38 did the keyboard and structure work and said plainly it "cannot prove screen-reader usability".** That stood open because the obvious way to close it is NVDA or JAWS, and neither is installed here (Narrator is, but cannot be driven headlessly to capture speech).

There was a more rigorous option nobody had reached for. axe-core checks RULES AGAINST THE DOM; a screen reader consumes the COMPUTED ACCESSIBILITY TREE, which is a different artefact - and CDP will hand it over. `tools/test-a11y-tree.mjs` reads that tree across all 35 sections.

The defect class it exists to catch, which axe-core structurally cannot: controls that are perfectly labelled in isolation and useless in an elements list, because AT users navigate by pulling up every control on the page stripped of context. It found exactly that: **8x "Open section"** on #/currency (mine, from session 48), **18x "Load into grader"** on #/write, and **2x "Compact"** in Settings (text size vs side-rail density). Fixed by naming controls for their destination and giving the shared optGrid helper an optional group name - with the visible text kept as a PREFIX of the accessible name, so WCAG 2.5.3 still holds. A fix that breaks speech input to help screen readers is not a fix.

**The checker was wrong three times before the app was.** Every heading level read as NaN (CDP wraps properties in an AXValue; `.value` returns the wrapper, not the number), reporting "0 level-1 headings" on 24 sections that were fine. `<input type="date">` was never name-checked at all, because Chromium exposes it under role `Date` - so the audit skipped the seven real date fields and flagged Chromium's internal spin buttons instead. Those internals were then reported as duplicates; they are browser-generated and unrenameable, now excluded with the reason recorded.

**Also:** `GUIDON_APP_VERSION` said 1.1.0 while every installer said 1.2.0 - the About panel was contradicting the thing it shipped inside. Now aligned. And `GUIDON_PROJECT_MAP.md` was refreshed from live figures: it claimed 26 routes (35), 290 doctrine entries (336), ~918 CSS classes (~1,048), and a build file that no longer exists.

**Verified:** 35 sections, eleven suites - verify, points, consistency, calendar, leader, privacy, scrollhint, a11y-tree, PDF, standalone file://, desktop CSP - all passing, zero warnings.

**What this does not claim:** it is not a substitute for a real screen reader driven by a real user. It reads the data AT is handed and asserts that data is usable; it cannot tell you whether the experience is. The gap is now narrower and measured rather than open and unmeasured.

## 2026-07-26 (session 43) - The seed optimisation everyone deferred, and a tab-strip affordance

**Ask:** continue from where the last session stopped.

**The seed, finally - by changing the lever rather than the schedule.** Deferring the seed is the oldest recurring item in this project. Every session reached the same conclusion for the same reason: the obvious lever is making the seed load ASYNCHRONOUSLY, which touches all 34 modules that read store.*, and risking a study app's correctness for ~200ms is a bad trade. Correct - and it meant nothing ever happened.

There was a second lever nobody had tested. V8 parses JSON with a dedicated parser materially faster than the full JavaScript parser over identical bytes, and the seed is already strict JSON sitting in an object-literal position. So `{...}` -> `JSON.parse("...")` is a build-time transform with no async, no module changes and no architectural risk.

Measured (median of 5 cold loads at 412x915): 1x CPU 85->81ms; 4x 395->362ms; **6x 652->558ms, a 94ms / 14% saving**. Cost is +0.11 MB raw and **measured ZERO gzip and ZERO brotli** - the escaped quotes compress away entirely, so nothing extra crosses the wire. Applied to both builds. That is 29% of the theoretical maximum (session 46 measured 329ms for removing the seed entirely) for none of the risk. The build asserts the literal is strict JSON and fails loudly if it ever stops being.

**The measurement lied first, and said what I wanted to hear.** The initial run reported JSON.parse 37% faster - because hand-rolled string escaping was wrong and the variant had silently stopped booting. The harness carried a `booted` flag next to every timing, which is the only reason it was caught. Fixed by letting JSON.stringify build the literal. A performance result without a correctness check beside it is not a result.

Seed integrity is now asserted in test-consistency.mjs: 17 top-level sections, 1,014 board cards, 3,629 acronyms, 336 doctrine entries, 163 MOS, 182 scenarios. A truncated seed would still boot, so booting is not the test.

**Tab strips now say they scroll.** Section 41 made .segmented scroll rather than wrap, fixing reachability but leaving no signal it moves - at 412px the Board Prep strip reads "... POINTS | RE..." and stops. The affordance is a MASK rather than a coloured gradient: with 24 themes any colour would be wrong in most of them, and the buttons paint their own backgrounds so a background gradient would sit behind them invisibly. A mask works on alpha and is correct in every theme for free. js/scrollhint.js sets data-scroll from measured geometry - overflow depends on how many tabs a view has, not screen width - and scrolls the active tab into view. High contrast disables the fade, since dimming an edge is the opposite of what that setting asks for.

Verified present at 412px, flipping side at the end of the strip, absent at 1440px where it fits, and suppressed under high contrast.

**Verified:** 35 sections, ten suites - verify, points, consistency, calendar, leader, privacy, scrollhint, PDF, standalone file://, desktop CSP - all passing.

**The lesson:** an item deferred for the same stated reason across many sessions is usually not blocked by effort, but by the approach everyone assumes is the only one. The seed was never the problem; the async refactor was.

## 2026-07-26 (session 42) - The ACFT audit two sessions declined, plus a currency surface

**Ask:** finish the remaining recommendations - freshness surfacing (#11) and the 175 unaudited ACFT references.

**Sections 28 and 46 both declined the ACFT sweep** on the grounds that a bulk find-and-replace over a 7,245-mention corpus would inject more errors than it removed. Both were right about the method and wrong about the conclusion. Walking the PARSED SEED and classifying by claim shape - rather than regexing raw text - found the real errors in one pass, and they were not naming drift:

- **THREE cards** answered that a 465+ AFT grants a taping exemption, while another card correctly explained that AD 2026-13 rescinded exactly that on 7 July 2026. The app gave opposite answers to the same live policy question.
- **Six cards** taught six events including the Standing Power Throw and Leg Tuck, both removed. One of them, `acft-events`, is the card section 28 recorded as fixed - its `.a` was corrected and its `.boardAnswer` was not. A card contradicting itself.
- **360** appeared as the current minimum in five places. That is the six-event maths; the AFT is 5 x 60 = 300, or 350 combat.
- A scenario ran on "302, two points below the 360 minimum" - under the AFT, 302 is a PASS. The premise was impossible.
- A **counselling bullet template** targeted "a passing ACFT score of 360 or higher", which a leader would paste straight into a live DA 4856.

Also corrected: two acronym definitions, three curriculum lessons, and resilience training guidance still programming for the SPT.

**New `tools/test-consistency.mjs`** - eight assertions over the parsed seed, four negative and four positive. The rule it encodes: a statement of the CURRENT standard must be current; historical framing stays allowed, which is precisely why a naive replace would have been vandalism. **The test was wrong three times before the content was** - it flagged "Single-Leg Tuck" (an FM 7-22 hip stability drill), then "Leg Tuck" in the FM 7-22 Climbing Drill, then my own corrected text saying the SPT "was removed". Every correction went into the checker, not the corpus.

**New `#/currency`** (#11) - eight policy areas, each with the edition it is built on, what depends on it, and who to ask. Age is computed from the stamp at render time, so the page gets more honest as the build ages rather than less. Bands are set by measured volatility, not importance. It deliberately does not phone home; faking a feed would be worse than the staleness it exists to surface.

**Verified:** 35 sections. Nine suites - verify, points, consistency, calendar, leader, privacy, PDF, standalone file://, desktop CSP - all passing, zero console output.

**The lesson:** two sessions logged this as "needs a contextual pass" and moved on because the tool they reached for was wrong. Deferring on method grounds quietly became deferring on substance. When the method is the blocker, change the method.

## 2026-07-26 (session 41) - Career Calendar, Enlisted Marketplace, Squad Roster

**Ask:** proceed with the next tier. (Labelling note: these were Tier 3 and Tier 4 in the original numbering - session 40 wrongly called them "Tier 2's remaining items". Tier 2 was #5/#6 and shipped in session 40.)

**`#/calendar`** - the dated spine. Every other section answers *what is true*; this answers *what is about to expire*. Seven tracked dates, each stating its consequence rather than just a reminder, sorted by urgency - a weapons qualification past 24 months is worth ZERO promotion points under AR 600-8-19 para 3-15a(2), and that is the most expensive date in the app. Plus two anchors nobody sets: the 26th-of-month promotion cut-off and the 1 Oct Credentialing Assistance reset ($2,000, no roll-over). Board date and ETS come from the profile rather than being asked for twice.

**`#/assignments`** - Enlisted Marketplace, previously zero coverage. Opens by stating who it applies to, because the Marketplace is principally SSG-MSG and a Specialist reading a generic "how to pick your assignment" page would be misled - their lever is reenlistment options. Covers YMAV, YMAEAT, the four annual cycles, the factors HRC weighs (time on station, KDA completion, unit strengths, CMF Talent Development Plan), and the mechanic that matters: anything left unpreferenced is treated as equally desirable and ranked between top-down and bottom-up, so silence is a choice. Cycle dates are not shipped - four a year and they move.

**`#/leader`** - Squad Roster. Tracks the duty leaders are most gigged on and least reminded about: monthly developmental counselling, plus AFT, weapons qual and NCOER dates per Soldier, surfacing who is overdue and by how much.

**And it created a privacy regression, caught by auditing rather than by testing the feature.** `G.backup.exportAll()` dumped the whole kv store - its comment read "Skip nothing here", which was true until a roster existed. Backups are downloadable and emailable, so a leader could have sent other Soldiers' data unknowingly. Now excluded by default via PRIVATE_PREFIXES, with `includePrivate: true` as a deliberate opt-in and `excludedPrivateEntries` / `includesOtherPeoplesData` in the payload. The consequence - the roster does not follow you to a new device - is stated in the module, not discovered.

**Verified:** 34 sections (was 31). Nine suites - verify, points, calendar, leader, privacy, PDF, standalone file://, desktop CSP - all passing, zero console output across 6 viewports. New tests assert the calendar's arithmetic (25 months = OVERDUE, 1 month = 701 days out), that Remove actually confirms and cancelling aborts, and that roster initials appear nowhere in a default backup payload.

**Not done from this tier:** the per-MOS credentialing pathway (#9). CMF-level mapping remains the coverage; going per-MOS needs Army COOL data the app does not have and should not invent.

## 2026-07-26 (session 40) - Policy currency, Records Readiness, points gap analyzer

**Ask:** Tier 1 + Records Readiness + points gap analyzer, auditing and hardening between tiers.

**The regulation was obtained, not summarised.** armypubs content search resolved AR 600-8-19, 6 March 2026 (ARN43646, effective 6 Apr 2026, now titled Enlisted Promotions and *Demotions*); the 121-page PDF was parsed locally. That corrected two things search alone had reported wrongly: the reg both *removes the requirement* to laterally appoint SPC->CPL and *establishes policy* for it, and it eliminates the HQDA bar for missing §D/DLC rather than "all references to DLC".

**Two long-standing open items closed with real data.** Weapons points were interpolated between two published anchors and labelled an estimate (§27). The anchors were right; the curve between them is not linear, so every interpolated middle row was wrong - replaced with the real tables 3-2/3-3. AFT was entered as pre-converted points; table 3-4 is now implemented, and the old hint claiming "a 500 is worth 80" was wrong - it is 120. Three weapon scorecards are selectable, because 30 hits maxes a DA 7814 pistol card but is mid-table on a rifle.

`tools/test-points.mjs` asserts all 90 published weapons rows, all 41 AFT bands, edge cases and every category maximum against the regulation.

**New `#/fitness`.** The Combat Field Test had ZERO mentions: 7 events, 24 MOSs, 30-minute cap, pass/fail, AD 2026-07, for-record from ~April 2027 with Flag code C. The AFT combat standard (21 MOSs, 350, AEA AECBTDQ blocking PCS) was also absent. This resolved the "21 or 24 MOSs?" open item - AFT combat = 21, CFT = those 21 plus 12D/89D/89E = 24. Two tests, two lists, never a contradiction.

**New `#/records`** - 23 checks across iPERMS, IPPS-A, ATRRS/DTMS, the cutoff clock and the board file, persisted to IndexedDB. Built on AR 600-8-19 para 3-14: corrections after a cutoff move the FOLLOWING month's score.

**Gap analyzer** now ranks quantified actions computed from the real tables ("+37 pts - requalify at 40/40") instead of ranking by remaining headroom, and takes a cutoff the Soldier enters. No cutoff scores are shipped.

Also corrected: Continuation Pay opens at 7 years from 1 Jan 2026 (was "8-12", in two places); Channels gained a 2026-changes panel covering lateral appointment, secondary-zone waiver removal, the DLC bar, and Credentialing Assistance ($2,000/FY via ArmyIgnitED).

**ACFT sweep audited and deliberately not done:** 221 references, 46 already flagged historical, 175 not. A regex cannot separate "the ACFT is the test of record" from "the ACFT was replaced" - which is why §28 refused a bulk replace. Measured and reported rather than rushed.

**Three self-inflicted faults, all caught:** Python `open(...,'w')` on Windows rewrote the whole 5 MB file to CRLF and broke the build anchor; `mount.appendChild(links)` turned out to appear in four modules and the continuation-pay sentence twice (the assert-exactly-once build rule caught both); and three test files each hard-coded "29 routes" - the same hand-maintained-list mistake §33 hit in the app, now derived via `tools/declared-routes.mjs`.

**Verified:** 27/27 - points - PDF - standalone file:// - desktop CSP, across 31 sections and 6 viewports, zero console output.

## 2026-07-26 (session 39) — Packaging: installable PWA, Windows desktop app, Android APK (guidon_index.html → guidon-app/ v1.2.0)

**Ask:** make this a top-notch mobile app and PC application.

**First, a correction to the record.** `guidon_86.html` does not exist on disk — the current build is `guidon_index.html` (5,133,364 bytes). `GUIDON_DEPLOY.md`, listed as canonical in the project map, had never been written. And the app has **29 routes, not the 26** the map claims.

### The blocker was structural, not incremental

Three independent things made installation impossible, and a baseline harness run measured it as **10 pass / 3 fail — every failure in packaging, none in the app**:

- `registerSW()` opened with `if (window.GUIDON_SINGLEFILE) return;` and that flag is always `true`. The service worker could never register in any deployment. A hosted copy had **no offline capability at all**.
- The manifest was a `data:` URI, which Chromium will not install from — so §42's Android install guidance pointed at a door that could not open.
- No `apple-touch-icon`, and `navigator.storage.persist()` was never called. The ~7-day iOS IndexedDB eviction §42 documents so carefully was only ever *warned about*, never *mitigated*.

### Now shipping

| Artifact | Size |
|---|---|
| `dist/guidon-standalone.html` — hand-someone-the-file build, promise unchanged | 4.90 MB |
| `web/` — installable bundle (real manifest, service worker, PNG/maskable/apple icons) | 4.06 MB + 896 KB |
| `GUIDON_1.2.0_x64-setup.exe` / `.msi` — Windows desktop app (Tauri, not Electron) | 2.34 / 2.77 MB |
| `app-debug.apk` — Android (Capacitor), fully offline, no hosting needed | 5.67 MB |

**The app now reloads and boots with the network disabled** — asserted by actually cutting the network, not by checking that a worker object exists.

### Performance, measured before cutting

At 6× CPU throttle: full build DomContentLoaded **744 ms**; deferring the PDF stack saves **113 ms**, deferring `GUIDON_SEED` would save **329 ms**. **First Contentful Paint is unchanged in every variant** (~130–180 ms) — the app already paints before the heavy scripts parse, so the cost was always time-to-interactive, never time-to-pixels.

Done: pdf-lib + both DA 4856 forms (896 KB) extracted and loaded only on export, still precached — offline export verified by generating a PDF with the network cut. Not done: the 3.26 MB seed, which every module reads and which has been flagged for its own dedicated session repeatedly. The number is recorded so the choice stays informed rather than merely deferred again.

### Verified, not asserted

Five suites: **27/27 verify · PDF · standalone (`file://`) · desktop CSP · Android**. The Windows app was confirmed by finding WebView2's `guidon` IndexedDB on disk with stores `kv`/`meta`/`userScenarios`/`attempts` and a real `streak:v1` write — runtime proof it booted and ran its data layer, not a blank window.

**The APK was run, not just built.** Installed on an Android 14 emulator and driven over raw DevTools Protocol (Playwright's `connectOverCDP` cannot attach to Android WebView). Against WebView Chrome 113: 29 routes, zero overflow, zero console output, `data-display-mode="native"`, IndexedDB working, **no service worker registered** — which was an open question, now answered by evidence — and a real 43,914-byte DA 4856 exported from APK assets with the PDF stack still deferred at boot.

**Two instrument errors, both mine, both caught before changing code:** a wrong length threshold (the asset holds *two* DA 4856 forms, 56,748 + 314,152 chars), and `sdk.dir=C\:\Users\…` in a Java `.properties` file silently parsing as `C:UsersObliv…` — forward slashes required. A third near-miss: pdf-lib's `Removing XFA form data…` warning looked like a deferral regression until the **untouched original build** produced it identically.

### Part 2 — PC and Android taken to native quality (Apple deferred at the owner's direction)

**The Back button did nothing, and only a device could show it.** Part 1 recorded a *deliberate* decision not to override Capacitor's Back handling, reasoning its default was already correct for a hash router. That reasoning was wrong. Measured on-device: Android's Back delivered `{canGoBack:false}` **with `history.length` at 33**, and Capacitor took no default action — Back neither navigated nor exited. `canGoBack` tracks WebView *document* navigation, which a hash router never performs. `src/native.js` now tracks its own depth: **close dialog → `history.back()` while depth > 0 → `exitApp()`**, with dialogs closed by dispatching Escape so `G.modal`'s own tested close path is reused. Automated as `npm run test:android:back`.

> **Reasoning about a platform is not evidence about a platform.**

**Android shell:** system bars now follow the active theme (colour read from the app's `--bg`, icon contrast computed from WCAG relative luminance, verified `#e8dfc9 ⇄ #0a0e12` on-device) · branded splash at all 11 densities plus the Android 12+ SplashScreen API · adaptive-icon background was `#fff`, showing white behind the mark under a launcher mask — now brand dark · **signed release APK 4.47 MB + AAB 4.34 MB** · phone form factor verified on a second AVD at a real **412×842 portrait** viewport, 29 sections, zero overflow.

**Windows:** remembers window size/position/maximised state and enforces **single instance** — both verified via Win32 (`200,140 1100×760` → close → relaunch → restored exactly). **The installer is now actually tested**, closing a Part 1 open item: silent install → per-user `%LOCALAPPDATA%\GUIDON` → Start-menu shortcut → correct Add/Remove entry → launches → silent uninstall leaves nothing behind. Publisher read `guidon` from the crate name; set explicitly.

### Open

**Windows code signing is not done** — SmartScreen will warn on an unsigned installer. Expected, not a defect; needs an Authenticode certificate before wide distribution. **The tab strip clips at 412 px** with no affordance that more tabs exist — §41's scroll-not-wrap decision stands, but a scroll hint would help; not changed here because `.segmented` is shared across 24 themes. A release keystore **was** generated at `keys/guidon-release.jks` (git-ignored) — **it must be backed up**, since the package name is permanently bound to it.

**Two more instrument errors, running total seven:** a fixed 900 ms wait raced with app init and reported a working feature as broken (fixed by asserting the real invariant and polling); and `| tail -N` on a background build masked both the error and the exit code, reporting Gradle's `BUILD FAILED` as exit 0 twice.

Full instructions: **`GUIDON_DEPLOY.md`**, written this session.

## 2026-07-23 (session 38) — Project Map: document index, feature summary, wiring diagrams (no build change)

**Ask:** a complete masterfile, plus a summary of all documents, feature sets, and visual aids showing exactly how the app is wired.

The masterfile itself (`GUIDON_MASTERFILE.md`) was already current at 42 sections and needed no rewrite — it's amended in place every session by design. What was missing was a **short entry point** into all of it.

**New: `GUIDON_PROJECT_MAP.md`.** Every number in it was pulled live from `guidon_86.html` rather than carried from memory, to avoid handing over stale figures after 37 sessions of changes: 26 routes across 5 nav groups, 34 JS modules, 24 themes, 33 CSS tokens, 1,014 board cards, 3,629 acronyms, 290 doctrine entries.

**Contents:** a document index (what each canonical file is and when to read it) · the feature set organized by nav group rather than build chronology · four ASCII wiring diagrams — the module map showing the `window.G` shared surface and exactly which modules expose what across it, a profile/board-date data-flow diagram showing how one date drives the Home countdown, the action plan's urgency, and the PPW calculator's advice, a storage-split diagram distinguishing IndexedDB from sessionStorage from the in-memory-only Guest profile, and a theme-system diagram — plus the six standing rules this project has actually needed, each traced to the specific bug that taught it, distilled from the "verify the verifier" lesson that recurred **ten separate times** before it stuck.

No app code changed. `guidon_86.html` remains the current build.

## 2026-07-23 (session 37) — Hosted access verified; Share & Install panel added (guidon_84.html → guidon_86.html)

**Ask:** can this be hosted online, opened by QR, and work on iPhone and Android?

**Yes — verified, not assumed.** The app was served from a real `https://` origin and opened under iPhone 15 Pro (Safari UA), Pixel 8 (Chrome UA) and iPad user agents. On all three: IndexedDB read/write works, the board renders, the manifest is present, service workers are supported, **zero external requests were made**, zero overflow, console clean.

**Transfer size measured, not estimated:** 4.89 MB raw → **1.47 MB gzipped (31%)**. The embedded JSON compresses extremely well. Any competent static host does this automatically.

### New section: Share & Install (`#/share`)

- **The app's own address**, in monospace, with a copy button — and the note that pasting it into any QR generator produces a scannable code for a flyer or a slide.
- **The iOS warning that actually matters.** Safari deletes a site's stored data after roughly seven days without a visit. A Soldier studying from a plain Safari tab can lose card grades, board date and action plan. **Adding to the Home Screen makes storage persistent** — the panel says to do it *before* starting, with the exact steps, and notes it must be Safari rather than Chrome or an in-app browser.
- Android install steps, with the honest note that Chrome has no equivalent seven-day rule.
- **What hosting does and does not change:** still one file, ~1.5 MB over the wire, still no external requests, study data still local — and plainly, **the server can see who fetched it.** That is a normal access log rather than study data, but it is not nothing and someone posting a link to a formation should know.

### A QR encoder was written and then removed

A full QR encoder — Reed-Solomon over GF(256), byte mode, versions 1–10 — was implemented directly in the app, since no CDN is permitted. It was then verified by **decoding its own output with OpenCV**, and the decoder could not read a single one of the four test codes.

**It was removed rather than shipped.** An unscannable QR that fails in front of a formation is worse than no QR at all, and debugging an encoder to genuine correctness needed more room than remained. The panel now points at the copy button instead, and the module carries a comment explaining what was tried and why it is gone — so nobody re-adds it without knowing.

This is the same discipline as the promotion-points work: the interpolated weapon table is labelled an estimate, the civilian-education rate is taken from the Soldier's own PPW rather than guessed, and now a QR encoder that could not be proven correct does not ship.

**Verification:** Share panel loads on both mobile profiles from a real HTTPS origin, shows the live URL, carries the seven-day warning, copy button present; **0 accessibility violations**; zero overflow; zero external requests; console clean; `node --check` clean.

New build saved as `guidon_86.html`.

## 2026-07-23 (session 36) — Adaptability audit across six real viewports; two genuine clipping bugs fixed (guidon_82.html → guidon_84.html)

**Ask:** ensure the quiz cards adapt to both the tablet and the Galaxy Z Fold 5 — and that the whole app does.

**Measured against real CSS viewports**, derived from physical resolution ÷ DPR rather than guessed: Z Fold 5 folded **344×882**, Z Fold 5 unfolded **673×841** (nearly square — the awkward one), Tab S9 FE portrait **720×1152** and landscape **1152×720**, plus 360×780 and 320×700 phones.

### The quiz cards were already fine — verified, not assumed

The board-drill card scales cleanly from **284×322 to 888×480**, holding a consistent 42–52% of viewport height at every size. Flipping to the answer face with the **longest card in the corpus** (`ucmj-2`, 1,911 characters of verbatim doctrine plus paraphrase plus key points) produced **no clipping at any viewport** — `.qz-back-scroll` correctly takes `overflow-y: auto` and becomes scrollable. Zero page overflow throughout. I checked before changing anything, and there was nothing to change.

### Two real bugs found in the wider sweep

**`.segmented` had `overflow: hidden`.** On a folded Z Fold (344px) and small phones, the trailing tab buttons were not merely cut off — they were **unreachable**. The Board Drill tab strip measures 570px against a 306px container. Fixed with `overflow-x: auto` plus `max-width: 100%`, scroll-snap, and a hidden scrollbar. Horizontal scroll rather than wrapping, because wrapping destroys the pill shape a segmented control depends on. **Verified scrollable at 344px: 570px content in a 306px box, `overflow-x: auto`.**

**The Channels gate table exceeded the viewport at 320px** — five columns cannot fit, and this was my own bug from session 30. Below 420px each row now becomes a stacked block with its column name as a prefix via `data-label`, so PME/TIG/TIS data stays readable on the narrowest screen the app supports.

### Result

**0 layout issues across 6 viewports × 16 sections** — down from 5. The sweep checks three things independently: page-level horizontal overflow, any element wider than the viewport, and horizontally clipped text in elements without a scroll affordance. All clean.

**Verification:** 0 accessibility violations at Z Fold unfolded across 4 themes × 4 sections (including two of the new Focus themes); `node --check` and CSS brace-balance clean; console clean at every viewport; no page errors.

New build saved as `guidon_84.html`.

## 2026-07-23 (session 35) — Focus theme set: 10 themes designed to one brief (guidon_80.html → guidon_82.html)

**Ask:** ten more themes that promote focus and stay easy on the eyes at any brightness.

**Designed to a brief, not assembled from taste.** Five principles applied uniformly to all ten:

- **Never pure `#000` or pure `#fff`.** Pure black causes halation — text appears to bleed, and it is markedly worse for anyone with astigmatism. Pure white glares under bright ambient light. Every background sits slightly off both.
- **Low chroma throughout, one restrained accent per theme.** Multiple competing accents are visual noise; noise is the enemy of focus.
- **Small surface-to-surface steps.** Panels sit close to the background so their edges do not glare, while text contrast stays high — the two are independent, and most themes conflate them.
- **No glow.** `--glow-amber: none` across the set. Glow fights readability.
- **Text contrast held at AAA.** Every theme lands **12.7–14:1** on body text, roughly double the AA requirement.

**The palettes were solved numerically before any CSS was written.** A script computed WCAG luminance ratios for each candidate and **iteratively tightened `--text-dim` until it cleared 4.5:1 against both `--bg` and `--panel`** — not adjusted afterwards when an audit complained. One accent came back at 4.36:1 and was darkened before shipping.

**Ten themes, spanning the brightness range:**

*Dim / night* — **Graphite Calm** (neutral, one steel accent; the default when nothing should compete for attention) · **Umber Lamp** (warm brown-black, low blue, for late study) · **Pine Dusk** (desaturated forest greys, sage accent)

*Mid / indoor* — **Slate Quiet** (a step lighter than the night set, sized for a bay rather than a dark room) · **Clay Warm** (comfortable under tungsten) · **Harbor Mid** (cool blue-grey, reads well under fluorescent)

*Bright / daylight* — **Parchment Read** (warm off-white, e-ink feel, long-form reading) · **Bone Neutral** (the most colour-honest light theme) · **Overcast** (cool light grey, tuned for glare) · **Sandstone Sun** (warm tan, built for direct sun on a tablet)

Grouped as **"Focus"** in the theme picker, separate from the existing Standard set.

**Verification:** measured ratios recorded per theme before implementation (text 12.66–13.98, dim-on-bg 6.14–8.09, dim-on-panel 6.64–7.43, btn-ink 4.64–7.92); **0 accessibility violations across the 10 new themes × 10 sections**; all 10 appear in the picker under Focus; selection applies, persists across reload, and sets the `light` class correctly (verified on both a dark and a light member); `node --check` and CSS brace-balance clean; console clean.

**Two build mistakes worth recording.** Injecting the CSS by searching for the last `</style>` put it **inside a JavaScript string** — the print-summary code contains a literal `</style>` in its generated HTML. A regex over `<style>…</style>` blocks hit the same trap for the same reason. Fixed by mapping every `<script>` span first and choosing a `</style>` outside all of them. **In a single-file app, markup-shaped strings live inside the JavaScript too; naive tag searching will find them.**

**An honest note on count.** This takes the app to **24 themes**, and the design handoff document names 14 as a maintenance liability — every component must clear contrast in every theme. These ten were built to a single coherent brief and are individually stronger than several of the older scattered ones. The right follow-up is to **retire some of the originals**, not to keep accumulating.

New build saved as `guidon_82.html`.

## 2026-07-23 (session 34) — On-device self-test suite (guidon_78.html → guidon_80.html)

**Ask:** a personal testing suite for the features I could not verify.

**New section at `#/selftest`, under Account.** Built to run on the Galaxy Tab itself, because that is where the untested things live — TalkBack, S Pen hover, genuine airplane-mode offline, print output, sunlight legibility. Playwright cannot reach any of them.

### Eleven automated checks, run in-browser on demand

Each reports pass/fail, the actual measured detail, and **why it matters** — so a failure is actionable rather than cryptic:

**Module integrity** (all 12 `G.*` modules registered — a missing one fails silently at runtime) · **Route health** · **Storage round-trip** (writes and reads back from IndexedDB — if this fails, grades silently stop saving) · **Content integrity** (1,014 cards · 3,629 acronyms · 336 doctrine entries) · **No external requests** (scans every `href`/`src` for `http(s)://` — this app must work with no signal) · **Screen-reader landmarks** · **Skip link reachable** (verifies it is genuinely the first focusable element — this caught a real bug last session) · **Heading hierarchy** (flags skipped levels) · **Contrast sample** (computes real luminance ratios on rendered text in the current theme) · **No horizontal overflow** · **Input mode** (reports pointer/hover/touch-points, marked informational because CSS cannot detect S Pen hover).

Verified live: **11/11 passing**, lowest sampled contrast 4.63:1.

### Nine manual checks, with actual protocols

Not a vague checklist — each says exactly what to do. TalkBack (five specific things to confirm, in order) · keyboard-only with no mouse · S Pen hover including that it must *not* fire on finger touch · airplane mode with a full app restart · rotation and split view · outdoor legibility across the five light themes · print output · persistence across a genuine force-stop · Demo Center dry run. **Ticks persist to IndexedDB**, so you can work through them across several sessions.

### Report export

Copies a plain-text report: build version, full user-agent, viewport and DPR, active theme, every automated line, and confirmed-versus-outstanding manual items. Useful for comparing two devices, or handing findings to someone else. Falls back to opening a printable window if the clipboard is unavailable.

### What it says it cannot do

The suite ends by stating plainly that **it cannot prove the app is usable with a screen reader.** It checks structure — landmarks, headings, focus order — which is necessary but not sufficient. Only running TalkBack answers that, which is why TalkBack is first in the manual list. A test suite that overstates its coverage is worse than none.

**Verification:** loads and appears in nav; 11/11 automated pass; 9 manual items persist across reload (confirmed 3/9); report export produces correct content; `node --check` clean; **0 accessibility violations across 14 themes × 12 sections** including the new section; console clean.

New build saved as `guidon_80.html`.

## 2026-07-23 (session 33) — Keyboard & screen-reader audit: a real skip-link bug found and fixed (guidon_76.html → guidon_78.html)

**Ask:** build out the remaining tasks.

**Started with the gap I had flagged hardest** — keyboard and screen-reader accessibility, never tested in this project's history. Zero axe violations across 14 themes is real, but automated tooling catches roughly a third of genuine accessibility problems, and structural keyboard behaviour is in the other two thirds.

### What was already right

Genuinely good, and worth recording so nobody "fixes" it later: one `main`, one `nav`, `lang="en"`, a single `h1`, a skip link that is correctly hidden off-screen at `left:-999px` rather than `display:none` (which would remove it from the tab order entirely), `:focus-visible` styles present on buttons/cards/inputs, two `aria-live="polite"` regions for dynamic announcements, and **no heading-level skips in any section**. The one focusable non-semantic element carries `role="button"` correctly.

### The real bug: the skip link was unreachable

**Symptom:** pressing Tab on a freshly-loaded page landed on the first *main-content* button. The skip link — first child of `.app`, correctly styled, no `tabindex` override — was never reached by forward tabbing.

**Cause:** the router focuses the view's `h1`/`h2` after each render, which is *correct* SPA practice — it announces the new view to screen readers on navigation. But it also fired on the **initial** render, dropping focus inside `<main>` before the user had pressed Tab once. Everything before `<main>` in the DOM, including the skip link, was stranded behind them.

A skip link that cannot be reached by pressing Tab is not a skip link. It was, in effect, decorative.

**Fix:** suppress the heading focus on the first render only, via a `_firstRouteDone` flag. On first paint focus stays at document start so the skip link is the first stop; every subsequent navigation still announces its heading exactly as before. **Verified both halves:** Tab now lands on `a.skip-link`, Enter moves focus to the `h2` inside `#main`, and navigating to Board Prep still focuses "Board Prep".

**Also added:** `role="banner"` on the topbar. Landmark navigation now offers banner / navigation / main rather than leaving the header unlabelled.

### Method note

I nearly mis-diagnosed this twice. The first probe reported the skip link missing — that was a wrong test (`offsetParent` is `null` for `position:fixed`). The second showed content buttons first, which I initially assumed was *also* a test artefact, because navigating after load legitimately moves focus. Only by reloading **without** navigating did the real failure reproduce. **The lesson cuts both ways: past instrument errors are not a licence to dismiss new evidence.** Testing the null hypothesis properly is what separated the artefact from the bug.

Separately, an early grep flooded the output with the 3,629-term acronym dictionary — the same mistake documented in sessions 14 and 21. Anchored patterns, always, in this file.

**Verification:** `node --check` clean; **0 accessibility violations across 14 themes × 12 sections**; console clean at error and warning; skip link reachable and functional; SPA heading announcement preserved on navigation; all three landmarks present.

New build saved as `guidon_78.html`.

## 2026-07-23 (session 32) — Design handoff note (no build change)

**Ask:** a comprehensive handoff note for Claude Design.

`GUIDON_DESIGN_HANDOFF.md` — the entry point for a designer, written to pair with `GUIDON_DESIGN_SYSTEM.md` rather than duplicate it. The system doc is the token and component reference; the handoff carries what a reference cannot: context, constraints, and the specific things that have gone wrong.

**Contents:** what the app is and who uses it (E-1 to E-9, the BLC → ALC → SLC → MLC → SMC ladder, a tablet in a motor pool with no signal) · the current numbers · the visual language and what it does and does not do · five hard constraints · **six landmines that each broke something real**, with the actual failures named · an explicit do-not-change list · a recommended priority order · the verification standard including both timing rules · and a plainly stated debt table.

**No code changed.** `guidon_76.html` remains the build.

**The gap flagged hardest:** screen-reader and keyboard-only testing has never been done on this app. Zero axe violations across 14 themes is real and worth having, but automated tooling catches roughly a third of genuine accessibility problems. That is now the top open item.

## 2026-07-23 (session 31) — Backlog cleared: six items completed, three declared blocked (guidon_74.html → guidon_76.html)

**Ask:** complete the remaining leftovers.

**Sorted the backlog honestly first.** Of 24 open items, six were genuinely completable, three are blocked on source documents I do not have, two need Chris's judgment rather than mine, one is a large architectural job, and the rest are standing test rules or perishable-data reminders that are not work at all.

### Completed

**Themed modal system (`G.modal`) replacing native `prompt()`/`confirm()`.** Native dialogs ignore all 14 themes, look wrong on a tablet, and are suppressed outright by some Android browsers. The replacement returns Promises and is properly accessible: `role="dialog"`, `aria-modal`, focus moved in and restored on close, **focus trapped with Tab/Shift-Tab**, Escape cancels, Enter confirms, backdrop click cancels. Destructive actions get a `danger` variant using `--ink-red`. All three Account-panel dialogs converted — rename, switch, and the double-confirm delete.

**Quiz study-level filter.** Board Drill had one; Quiz did not. Now filters the pool and the question count together — verified 1,014 → 87 selecting Expert. Defaults to "All levels", so existing behaviour is unchanged unless someone opts in.

**Nav re-tap now re-renders.** Tapping the nav item for the section you are already in did nothing, because the hash never changed and `route()` never fired — leaving a drill sub-view or expanded panel stuck open. It now forces a re-render when the hash matches.

**Guest mode gets a session-only action plan.** Guests previously had no plan at all, which made Home and Progress look broken during a walk-through — exactly when the app is being shown to someone. Four starter items now live in the in-memory cache only and are **never written to IndexedDB**, so "nothing is saved" stays literally true. Verified: 4 items present, profile key absent from storage.

### A mistake worth recording

The difficulty filter first landed in the **wrong renderer** — Board Drill, which already had one — because both renderers declare a `catSel` and I matched the first occurrence. The `typeof diffSel !== "undefined"` guard I had written meant it failed silently rather than crashing: no error, no filter, no signal. Caught by testing the actual control rather than trusting the edit, then relocated to Quiz and the duplicate removed. **This is the second time a defensive `typeof` guard has converted a real bug into a silent no-op** — the first was the Demo Center's empty tour. Guards like that hide exactly the failures worth seeing.

### Declared blocked, with reasons

- **AR 600-8-19 weapon hit-count tables (3-7 / 3-8)** — I have two published anchor values and interpolate between them. Real rows need the actual tables; inventing intermediate values would be worse than the labelled estimate now in place.
- **Civilian-education per-semester-hour rate** — never verified in research, so the worksheet takes the figure from the Soldier's own PPW rather than applying a rate I would be guessing.
- **Combat Field Test** — sources disagreed on whether 21 or 24 MOSs are designated. Not shipping a number I cannot stand behind.
- **~5 Commander's Intent cards and ~87 Expert-tier cards** — content judgment on someone's study material. My earlier automated attempt at this produced false positives; a person should decide.
- **Lazy-loading the 5 MB seed** — a genuine architectural change that deserves a dedicated session with its own regression budget, not a tail-end addition.

**Verification:** `node --check` clean; **0 accessibility violations across 14 themes × 12 sections**; console clean at error and warning; guest plan present but unpersisted; quiz filter narrows correctly; nav re-tap returns to the drill menu; themed dialog opens with focus trap, Escape closes it, and the profile is unchanged after cancel; **no native dialog fires anywhere in the Account panel**.

New build saved as `guidon_76.html`.

## 2026-07-23 (session 30) — Five-phase ship: design hardening, Channels, closed loops, polish, design-system doc (guidon_68.html → guidon_74.html)

**Ask:** ship the remaining backlog in phases, auditing and hardening at each phase, with backwards and forward compatibility preserved throughout.

### Phase 1 — Design-system hardening
Audited all 331 hex colour values and separated them properly: **283 sit inside theme or `html.light` token-definition blocks (legitimate)**, and print styles are deliberately black-on-white. That left **46 genuinely loose values**, of which **16 were converted to tokens** — `.leech-badge`, `.ob-g-mark`, `.chip.req`/`.chip.opt`, `.idp-smart-k`, the mock-board spark bars and trend markers, the overdue-reminder states, and three segmented-button active states. Loose values outside tokens and print: **46 → 7**.

Done first deliberately: every contrast bug found across recent sessions — `.ob-avatar` at 2.55:1, the orphaned nav rule — was a hardcoded value bypassing the token system. Handing that to a redesign unfixed would surface them one at a time as theme-specific mystery bugs.

### Phase 2 — Channels & Gates (`#/channels`)
The most-researched, least-built item finally shipped. Nine "what do I need / who do I see / what should I know" rows covering S-1, ATRRS, ATIS, career counselor, HRC branch manager, chain of command and My Board File — including the plain statement that **a recruiter is not a promotion channel**, because Soldiers ask them anyway. Plus the PME/TIG/TIS gate table, the five systems and what each decides, and the rule underneath all of it: **if it is not in the system by the cut-off, it did not happen.** The ARNG-sourced TIG/TIS caveat sits on the table itself rather than buried.

### Phase 3 — Closed loops
- **Board countdown now appears on Home**, not only Board Prep. Required exposing `G.renderBoardCountdown` across the module boundary — the same class of fix as `G.routes`. Backwards compatible: the renderer draws its own "set a date" row when no date exists.
- **The PPW calculator now speaks to the board date.** Previously it produced a number and said nothing, despite the app knowing both the date and the rank. Advice now scales with proximity: inside 7 days it says points are effectively locked and to verify IPPS-A; inside 30 it names awards and correspondence as the only categories that realistically still move; beyond that it points at the biggest category gap.

### Phase 4 — Polish
- **Branding corrected E1–E6 → E1–E9.** The app teaches MLC and the Sergeants Major Course; the topbar said E1–E6. **Only the two branding strings were changed.** The AAM board card's "junior enlisted (E1-E6)" is factually correct doctrine, and `rank: E1-E6` appears seven times as a *functional filter key* inside IDP goal data — changing it would have silently broken goal targeting for every existing profile. Backwards compatibility beat cosmetic consistency.
- **Printable readiness summary** added to the Account panel: name, MOS, tier, board date and days out, cards graded, Know-It-or-better percentage, the full action plan, and signature blocks for Soldier and counselor. Built from live data at print time; nothing stored, nothing leaves the device. Board prep is counseling material and a Soldier should be able to hand a squad leader evidence.

### Phase 5 — Design-system reference (new canonical document)
`GUIDON_DESIGN_SYSTEM.md`, written for a designer picking this up cold. All 33 tokens grouped by purpose with the rules that matter (`--text-mute` is decorative and fails 4.5:1; `--ink-*` for accent-as-text; `--btn-ink` for text on accent fills, the single most-violated rule in the codebase). Plus the 14 themes and the light-class gotcha, the 21 media conditions with a consolidation recommendation, the component inventory, five architecture constraints including the silent-failure mode of cross-module `typeof` guards, the verification standard with both timing rules, and an honest design-debt table.

### Verification
`node --check` clean on all inline scripts; brace balance clean across all 4 style blocks; **0 accessibility violations across 14 themes × 12 sections**; console clean at error and warning; backwards compatibility confirmed live — an existing personal profile still loads with its 6-item plan, onboarding still completes, and a board date set on Home correctly drives both the countdown and the PPW advice.

New build saved as `guidon_74.html`.

## 2026-07-23 (session 29) — Glossary, doctrine and bibliography expanded for the NCOPDS ladder (guidon_66.html → guidon_68.html)

**Ask:** expand the glossary, acronyms, definitions and bibliography to cover BLC → ALC → SLC → MLC → SMC — sensibly, not exhaustively.

**Gap analysis first, so nothing was duplicated.** Checked 67 candidate NCOPDS terms against the existing 3,592-term dictionary: 37 were genuinely missing, 30 already present. Only the missing ones were added — the dictionary is now **3,629 terms**, and the advertised count was updated to match rather than left stale.

**Acronyms added** — the ones a Soldier actually meets in course paperwork and cannot look up anywhere else in the app: **ISAP, NCOLCoE, USANCOA, NCOA, RTI, SGL, ALA, NCO-C3, DHG, DLG, SGM-A, EPS, DLC, PPW, PSL, STAB, OML, CES, PEBD, MBF, ASBS, ATIS, iPERMS, WHtR, 2MR, SPT, CIT, FD1, MMD, RD, TR** plus the assessment forms by number — **1009A, 1009S, 1009W, DA 1059, DA 2977, DA 4856**. Several carry the currency note inline: SPT is flagged as removed when the AFT replaced the ACFT, DLC as eliminated as a PME prerequisite on 1 October 2024.

**Fifteen new doctrine entries** under a "NCO Development" topic, each sourced and searchable alongside the existing corpus: the NCOPDS ladder and its pin-on gates · NCO-C3 · DA Form 1059 outcomes and the two-"Did Not Meet" rule · the 1009A scoring maths and the 480 threshold · academy honours with their promotion-point values and the negative-counseling disqualifier · the five Army writing standards including what Advanced actually means · reassessment and dismissal · the information brief and why it is not a Q&A · conducting PT and the DA 2977 · squad drill and the squad leader's inspection · MDMP · servant leadership and followership · the be-know-do model · ATRRS/IPPS-A/iPERMS/ATIS and what each decides · and the DLC elimination, because Soldiers are still being told otherwise.

**Bibliography** added to the Drills module — every publication these drills are built from, grouped by purpose (course and assessment · promotion · leadership and development · operations and planning · drill, fitness and standards · writing and administration), each with a line on what it actually governs. It opens by telling the reader to go read the source rather than taking the app's word for it.

**Verification:** dictionary at 3,629 terms with the advertised count matching; all new acronyms resolve; 15 NCOPDS doctrine entries present and reachable; live search confirmed working for both a new acronym (ISAP) and a new doctrine entry (NCOPDS); bibliography renders with every reference confirmed; `node --check` clean; **0 accessibility violations across 4 themes × 10 sections**; console clean; zero overflow at 360px.

**A refinement to last session's standing rule — and a case of not dismissing new evidence.** Two contrast violations reappeared on night-vision Home at a **400ms** settle, which is past the 0.15s nav transition that explained them last time. Rather than wave them off as the known artefact, I retested: **0 violations at a 1500ms settle**, and 0 across the whole matrix once a settle was added *after each theme change*. The refinement is that **a theme switch itself triggers colour transitions across the entire UI** — so the settle has to follow the theme change, not only navigation. The earlier rule was right but incomplete.

New build saved as `guidon_68.html`.

## 2026-07-23 (session 28) — NCOPDS Drills module; Demo Center rebuilt on ROUTES (guidon_64.html → guidon_66.html)

**Ask:** legitimate study aids and training modules for BLC and ALC; and a full revamp of Demo Center / Kiosk so the newer components are wired in, with visual guidance for both guided and self-driven demos.

### Part 1 — NCOPDS Drills (`#/drills`, Leadership group)

Six rehearsable versions of what BLC and ALC **actually grade**. Sequences and point values come from the BLC ISAP rubrics, TC 3-21.5 and ATP 7-22.02 — so practising here is practising the real assessment, not an approximation.

- **Squad Drill sequence** — all 20 graded performance steps in order, as a recall trainer (say the command, then reveal), plus the full sequence grouped by phase. −5 points per step missed.
- **PRT session builder** — both sessions you may be assigned, block by block: Strength & Mobility (PD → SSD → CD1 → CD2 → RD) and Endurance & Mobility (PD → HSD → MMD1 → MMD2 → RD), with every exercise named. Leads with the thing people forget: a **hard-copy DA Form 2977 and a risk brief are scored steps before a single exercise happens**, and each step is all-or-nothing.
- **Information brief rehearsal** — a live timer that colour-codes the real window: amber under 8:00, green through the acceptable 8:00–12:00 band, red past 12:00. Paired with the actual **1009S rubric, all 17 line items with their point values**, as a self-score. States plainly that an information brief is not a Q&A and the clock stops when you ask for questions.
- **Essay word-count & rubric** — live word count against the *actual* assignment ranges (250–750 compare-and-contrast, 750–1250 informative, two-page SHARP), telling you exactly how far over or under you are, because Concision is a scored standard. Plus the five writing standards with what Advanced actually means — main point in the top 2%, roughly 80% analysis to 20% summary.
- **Conduct Individual Training** — all 25 performance steps as a checklist, grouped by phase, with the arithmetic stated: −4 each, miss eight and you are below 70.
- **MDMP step trainer** — the seven steps as a recall drill on **what each step produces**, not just its name.

Cross-linked from BLC and ALC; nothing leaves the device.

### Part 2 — Demo Center rebuilt

**The tour was three sections out of date and nobody had noticed.** `DEMO_STEPS` was a hand-maintained list of 19 stops that never gained BLC, ALC or SLC — the three newest modules were invisible in the tour used to showcase the app. Now **derived from `ROUTES`**, so a new section cannot be forgotten again. **24 stops, verified.** This closes a long-standing open item.

**Per-stop "◉ Show them:" callouts.** The old tour narrated what each section *is*; it never said what to actually point at. Every stop now carries one concrete cue — tap the board-date banner to switch countdown/date; open BLC's honours section for the real point values and the negative-counseling disqualifier; start the brief timer to show the live window colour-coding.

**Presenter cheat-sheet on the mode picker** — all 24 sections with their cues in one tappable list, each row jumping straight to that section. Free Mode drops you at Home with no view of its own, so without this a presenter running free had no cue card at all.

**Real bug found and fixed during the build.** The first ROUTES-derived implementation produced an **empty** `DEMO_STEPS` and threw `Cannot read properties of undefined (reading 'title')` on every tour render — `ROUTES` is scoped inside the app-shell IIFE and is not visible to the profile module where the kiosk lives. My `typeof ROUTES !== "undefined"` guard failed silently to an empty array rather than erroring loudly. Fixed by exposing `G.routes` as the single source of truth, and the card renderer is now hardened against an out-of-range index.

**Verification:** `G.routes` exposed with 26 routes; 24 tour stops derived; cheat-sheet renders 24 rows with BLC, ALC, SLC and Drills all present; tour renders with callouts; all six drills open, and every interaction confirmed — PRT tab switching, essay standards, 25 CIT checkboxes with correct first and last steps, MDMP advancing and revealing, squad-drill reveal, brief timer counting. `node --check` clean; **0 accessibility violations across 5 themes × 10 sections**; console clean; zero overflow at 360px.

**Instrument errors, ninth and tenth instances.** Three separate probe failures were all the test: a case-sensitive check against a CSS-uppercased step counter; `location.hash` set to the page already displayed, which does not re-render, so the drill menu never returned; and `innerText` missing content that `textContent` found. Each was confirmed against the DOM before anything was "fixed" — the app was correct all three times.

New build saved as `guidon_66.html`.

## 2026-07-23 (session 27) — ALC practitioner advice folded in (guidon_62.html → guidon_64.html)

**Ask:** add practitioner advice to the ALC module, matching what BLC received.

**New section — "From people who have been there"** (11 points), drawn from NCOs who have completed ALC and from a former ALC instructor. Self-check extended 10 → **12 items** with the two most controllable inputs.

**The highest-value item, and the one most often missed: classroom participation is graded.** It now leads the section and has its own self-check line. Speak in every discussion, including when you disagree, and bring your own experience rather than restating the reading.

**Other substance encoded:**
- Instructors are watching outside graded events — during discussion, breaks, and in how you treat your study group. Being genuinely useful to peers is precisely what the Develops/Collaboration competency measures.
- **Your AFT score feeds the Presence rating on the 1009A**, which flows to the DA Form 1059. One of the few inputs entirely within your control before you arrive — now also a self-check item. *(Note: the advice as given said "1059A"; corrected here — the 1009A is the assessment form, the DA Form 1059 is the Academic Evaluation Report it feeds.)*
- **Cheating or plagiarism gets you dropped.** Stated flatly.
- **Write the way you actually speak.** One NCO was marked down for reaching for words like "labyrinth" and "purview"; the SGL told him to stop googling impressive vocabulary. This lands directly on the writing rubric — clarity scores, performance does not.
- Day-to-day reality: formation around 0630, released around 1800, open-bay billeting and shared showers common, DFAC three times daily. Some days end near 1400 but you stay in the classroom — use that block and your evenings stay yours.
- **A former ALC instructor's warning:** plenty of Soldiers believe they are comfortably coasting right up until they are told they did not qualify for Commandant's List or honours. Coasting and competing look identical from the inside.
- The social dynamic: three archetypes exist, including people competing hard enough to undercut peers. Recognise it, refuse to be drawn in, keep helping people — sniping at classmates is visible to cadre and costs the person doing it.
- On slide-polishing culture: the hours are real and the stated rationale (visible small errors pull attention off your content) does genuinely play out in briefings. Meet the standard quickly; do not let it eat the time your analysis needs.

**One editorial decision, made openly.** The source material used a slur for people with disabilities and a crude sexual jibe. **The observations underneath were worth keeping; the language was not** — this is an app a Soldier may show their unit, and a slur about disabled people has no business in it. The section says plainly that it has been reworded, so nobody is misled into thinking it is a verbatim quote. Nothing substantive was softened: "you will be dropped," the coasting warning, and the peer-sniping dynamic are all intact.

**Verification:** 10 sections load and expand; all 13 content probes confirmed at runtime; **automated slur check returns clean**; self-check persists across reload (5/12) and is independent of BLC's (0/12); `node --check` clean; **0 accessibility violations across 8 themes × 10 sections at a 400ms settle** (per the standing rule added last session); console clean; zero overflow at 360px.

New build saved as `guidon_64.html`.

## 2026-07-23 (session 26, part 2) — BLC module rebuilt from the authoritative ISAP (guidon_60.html → guidon_62.html)

**Ask:** research the uploaded BLC Individual Student Assessment Plan, replace stale bits with current information, and fold in practitioner advice from NCOs who have been through it.

**The source changes everything.** Chris supplied the actual **BLC ISAP (NCOLCoE, course 600-C44, October 2020)** — the document that defines how BLC is graded. Session 24's BLC module was written from general knowledge; this rebuild is built on the grading instrument itself. Module grew from 12,894 to **25,949 characters**, 7 sections to **17**, self-check from 10 to **12 items**.

**What the ISAP gave that general knowledge could not:**
- **The six GPA assessments, named**: 1009S information brief · 1009W compare-and-contrast essay (followership vs servant leadership) · 1009W informative essay · Conduct Individual Training · Conduct Physical Training · Conduct Squad Drill. **Miss a deadline without prior coordination and it is a zero.**
- **The 1009A — the assessment nobody studies for.** Six attributes/competencies × four modules × 25 points = 600 max. **480 is the gate** for Commandant's List and Superior Academic Achievement. Two or more "Did Not Meet" ratings in Part II blocks f–k forces "Failed to Achieve Course Standards" overall.
- **The real honour numbers**: Distinguished Honor Graduate 40 promotion points (highest GPA) · Distinguished Leadership Graduate 40 (NCOA SOP) · Commandant's List 20 (top 20%) · Honor Graduate, Commandant's Writing Award and Iron Soldier 5 each. **Any negative counseling disqualifies you from all six.**
- **The 1009S is not a Q&A** — 10 minutes ±2, and the clock stops when you ask for questions.
- **Essay specifics**: compare-and-contrast 250–750 words; informative 750–1250, five-paragraph, graphic organizer submitted with the paper. The writing rubric scores Purpose (BLUF — Advanced means main point in the **top 2%** of the document), Analysis (**Advanced ≈ 80% analysis / 20% summary**), Syntax, Concision, Accuracy.
- **Practical rubrics**: individual training is 30 min ±2, 25 steps, **−4 points each**; PT requires a **hard copy DA Form 2977** risk worksheet and each step is **all-or-nothing**; squad drill is TC 3-21.5, 20 steps, **−5 points each**.
- **Reassessment reality**: maximum **two** during enrollment, a passed reassessment is **capped at 70%** and **removes you from honours consideration**; fail one or need a third and you are recommended for dismissal. Disenrollment for disciplinary or motivational reasons bars further NCOPDS for **six months**, and re-enrollees **start the course over**.
- The **SHARP essay** carries a warning worth surfacing: disclosing an incident in it triggers an **unrestricted report**.

**Stale bits corrected against current information** (dedicated "What has changed since the ISAP was written" section):
- The ISAP's grader-certification rubric still lists **SPT and Leg Tuck** — doubly out of date. LTK was replaced by the Plank in 2022, SPT was dropped when the **AFT replaced the ACFT on 1 June 2025**. Current five events: MDL, HRP, SDC, Plank, 2MR.
- **SSD I / DLC I** prerequisites — eliminated for resident NCO PME effective **1 October 2024**.
- The **Army Directive 2020-06** protections quoted throughout expired 31 March 2022; fitness scores are used administratively and for promotion points again.
- **ABCP**: no AFT-score exemption — AD 2026-13 rescinded AD 2025-17 effective **7 July 2026**.
- **Course length**: BLC is being lengthened under the PME transformation with land navigation added; a 29-day BLC has been validated and ARNG piloting has begun.

**Practitioner advice folded in** as its own section — deliberately kept in the register it was given in, because sanitising it would strip what makes it useful: passing is easy if you show up and give a damn; follow the rubric and answer what it actually asks; ask the instructor even if the question feels dumb; **be creative** because cadre have seen the same brief a thousand times; get nominated for the **DLA — it carries more weight than C-List or DHG**; PT hard and speak up; slow the PRT cadence down, it is graded; volunteer for a leadership role; be a team player and do not be the one goofing off while the squad works; save the resources — the course shows you the tools, it does not make you a leader.

**Verification:** 17 sections load and expand; every ISAP content probe confirmed at runtime (600-C44, 169 academic hours, 1009S/1009W/1009A, the 480 gate, Distinguished Leadership Graduate, Iron Soldier, DA Form 2977, TC 3-21.5, reassessment policy); self-check persists across reload (6/12); `node --check` clean; **0 accessibility violations across 8 themes × 10 sections**; console clean; zero overflow at 360px.

**Test artefact, eighth instance — and this one nearly caused a wrong fix.** The pre-compaction regression reported 2 contrast violations on `#/home` in night-vision. They would not reproduce in isolation. The cause: the sweep used a **150ms settle** and the nav has `transition: color 0.15s` — axe was sampling mid-transition. Re-running the identical sweep at a 400ms settle: **0 violations**. Had I "fixed" the nav colours on that evidence I would have altered working code to satisfy a stopwatch.

New build saved as `guidon_62.html`.

## 2026-07-23 (session 26) — SLC & Senior NCO Path module; PME transformation caveats added across the ladder (guidon_58.html → guidon_60.html)

**Ask:** proceed with the logged next steps — an SLC module of its own, plus MLC/SGM-A coverage to complete the NCOPDS ladder — with comprehensive research first.

### The finding that changed the shape of this build

Research surfaced that the Army's **NCO PME transformation is in execution, not under consideration** — senior enlisted leadership has described it in exactly those terms. Course lengths are actively moving across the entire ladder. That has a consequence beyond the new module: **my own BLC and ALC modules from sessions 24 and 25 had already gone stale**, because both quoted lengths that are now changing. Both were caveated in this pass rather than left to quietly mislead.

**What is moving:**
- **BLC lengthened** — reporting ranges from five to six weeks, with new land navigation content
- **ALC and SLC both shortened** — early reporting said compression to ~3 weeks; later reporting said a reduction of more than a week each. **These two accounts disagree, and the module says so** rather than picking one and presenting it as settled
- **MLC expanded from 15 to 21 days**
- **Sergeants Major Course resident stays 10 months**; the distance-learning route drops to ~12 months from 18–24
- All sergeants major to attend a **72-hour warfighting exercise** at Fort Bliss
- The through-line is warfighting focus — non-warfighting requirements deliberately stripped

### New section at `#/slc` — "SLC & Beyond"

Eight sections, opening deliberately with the PME-change warning so nobody plans around a stale number.

- **What SLC actually is** — third NCOPDS course, branch-specific, SSG(P)/SFC, platoon-and-company scope, aimed at eventual first sergeant duties, pin-on requirement for MSG
- **SLC NCO-C3** — the supplied official description: be-know-do model, innovative approaches to leadership and training, management techniques, mission command **systems** analysed, analytical essay, platoon training and leader development plans
- **The writing is the thing that catches people** — the distinction that matters: a persuasive essay takes a position and defends it; an **analytical** essay breaks a problem apart and follows the evidence, *even to a conclusion you did not want*. APA format is required at some academies
- **Platoon training & leader development plans** — the products a platoon sergeant actually owns; the honest note that Soldiers who have only executed someone else's plan struggle here
- **Sharpen the sword** — by SLC you are assessed on judgement more than knowledge, which is harder to cram and easier to build
- **Master Leader Course** — branch-immaterial, SFC→MSG/1SG, tactical-to-operational transition. **MDMP has been newly introduced to MLC** — it was not previously part of the course — culminating in a three-day, ~24-academic-hour warfighting capstone applying the first three MDMP steps in a first-sergeant context. Revised curriculum adds explicit 1SG responsibilities on the recommendation of previous graduates
- **Sergeants Major Course** — the capstone; resident 10 months, DL dropping to ~12, the Fort Bliss warfighting exercise, and the conditional-promotion provision for MSGs serving in the higher graded position

Plus a **10-item SLC-specific readiness self-check** on its own key (`guidon:slc:checks:v1`), verified independent of the BLC and ALC checks.

**The NCOPDS ladder is now walkable end-to-end in-app:** BLC → ALC → SLC → MLC → SMC, each module cross-linking forward and back.

**Verification:** all eight sections load and expand; every content probe confirmed at runtime (be-know-do, analytical essay, "MDMP has been newly introduced", 15→21 days, 10 months, 72-hour warfighting, APA); self-check persists across reload (3/10) and is independent of ALC's (0/10); PME caveat confirmed present in BLC; all three modules in the Leadership nav group; `node --check` and CSS brace-balance clean; **0 accessibility violations across 3 themes × 9 sections**; console clean; zero overflow at 360px.

**Test artefact, seventh instance:** an initial check reported the SLC module not loading. It was loading fine — the heading is CSS-uppercased and my probe was case-sensitive. Confirmed by reading both `textContent` and `innerText` rather than assuming either way.

New build saved as `guidon_60.html`.

## 2026-07-23 (session 25) — ALC Prep module, with SLC forward-look (guidon_56.html → guidon_58.html)

**Ask:** add an ALC module covering as much as possible without OPSEC concerns. Official NCO-C3 course descriptions for both ALC and SLC were supplied and used as the authoritative spine.

**New section at `#/alc`, under Leadership**, mirroring the BLC module's structure. Everything in it is public doctrinal or published course information — nothing unit-specific, no packing lists tied to a location, no anything that would be sensitive.

**Seven sections:**
- **What ALC actually is** — the thing most Soldiers get wrong: ALC is not one course. Phase I is the branch-immaterial NCO-C3 common core (typically virtual); Phase II is the MOS-specific technical track (resident). Phase I gates Phase II. Total length varies roughly **2 to 55 weeks** depending on technical track. Pin-on requirement for SFC; 150 promotion points for ALC graduates recommended for SSG.
- **Getting a seat — how HRC prioritises** — there are routinely more eligible NCOs than seats, and HRC enrols from an order of merit list: (1) SSGs who have completed their technical track, (2) all other SSGs, (3) promotable SGTs who have completed their technical track, (4) all other SGTs — date of rank decides within each tier. **The practical read: completing the technical track early moves you up an entire tier.**
- **NCO-C3 — what the common core covers** — the official description verbatim in substance: Leadership Requirements Model through a holistic approach, written and oral communications, critical thinking, creative ideas, complex problem solving; key lessons being servant leadership, mission command philosophy, persuasive essay, military briefing, and MDMP; outcome is train/lead/conduct operations at squad level.
- **The step up from BLC** — where NCOs get caught out: a persuasive essay requires taking a position and defending it, not summarising; the briefing is timed and questioned; MDMP is often the first formal end-to-end planning process an NCO meets; problems are deliberately ill-structured with no school solution; peer collaboration is itself assessed.
- **Sharpen the sword** — the ALC wait is usually months, and that is preparation time.
- **After ALC** — verify the 1059 reached iPERMS, confirm the 150 points landed, and start developing the NCOs below you because at SSG you are judged on the sergeants you build.
- **Looking ahead — SLC** — the supplied official description: be-know-do model, innovative approaches to leadership and training, management techniques, mission command *systems* analysed rather than the philosophy examined, analytical essay, platoon training and leader development plans. Noted as the pin-on gate for MSG, with the practical takeaway that building training plans at SSG makes SLC recognition rather than revelation.

**Doctrine currency finding folded in.** Research confirmed the Army **eliminated the DLC I–VI requirement for resident NCO PME effective 1 October 2024** — DLC (formerly SSD) had gated PME attendance since 2010. The module states this plainly, because Soldiers are still being told they need DLC II before ALC. This also closes one of session 24's flagged open items.

**A 10-item ALC-specific readiness self-check** persisted to its own IndexedDB key (`guidon:alc:checks:v1`), verified independent of the BLC check. **BLC now cross-links forward to ALC**, completing the NCOPDS ladder in-app.

**Verification:** ALC loads with all seven sections; SLC section content confirmed (be-know-do, analytical essay); MDMP coverage confirmed; self-check persists across reload (4/10) and is **independent of BLC's** (0/10 while ALC held 4/10); both sections present in the Leadership nav group; `node --check` and CSS brace-balance clean; **0 accessibility violations across 3 themes × 9 sections**; zero console errors or warnings; zero overflow at 360px.

**One test artefact worth noting:** an initial check reported the DLC currency note missing. It was present — the test had only expanded the SLC section, not the one containing it. Confirmed by source inspection rather than assumed either way.

New build saved as `guidon_58.html`.

## 2026-07-23 (session 24) — Doctrine currency pass + BLC preparation module (guidon_54.html → guidon_56.html)

**Ask:** verify seed data / ARs / FMs / TCs are current to roughly Apr–Jul 2026, changing only what current information actually supports; and add an extensive BLC preparation module for E-4 promotable and Corporals.

### Part 1 — Doctrine currency

**Scope check first.** The corpus cites **299 distinct publications across 7,245 mentions**. Verifying all of it is not achievable in one pass, so it was prioritised by staleness risk. Legacy-marker scan: ACFT 212 mentions vs AFT 103, ADRP 14, APFT 56, SSD 20.

**Two concrete, sourced corrections made. Nothing else was changed** — per the instruction to only act where current information was actually found.

**1. The "six events of the ACFT" board card was teaching a wrong answer.** The AFT replaced the ACFT on 1 June 2025, dropping the Standing Power Throw and reducing the test from six events to five (max 500 points, not 600). The app contained an internal contradiction — one card correctly said the SPT was removed while `acft-events` still asked for six. Rewritten to the five AFT events with the 60-points-per-event floor and the transition date.

**2. The ABCP taping-exemption card was describing a policy that no longer exists.** Four instances taught "465+ with a minimum of 80 points per event" as an exemption from body-composition standards. That exemption came from **Army Directive 2025-17, which was rescinded by Army Directive 2026-13 effective 7 July 2026** — sixteen days before this session. All Soldiers now meet the standard regardless of AFT score. Corrected, with the directive cited so the answer is defensible at a board.

**Deliberately not changed:** ~212 remaining ACFT references were left alone. Many are legitimately historical (comparisons, "the ACFT was replaced by…"), and bulk find-and-replace across a 7,245-mention corpus without reading each in context would create more errors than it fixed. Logged as a scoped follow-up rather than done carelessly.

### Part 2 — BLC Prep module (new section, `#/blc`)

New top-level section under **Leadership**, aimed at E-4(P) and Corporals. Written as preparation for leading rather than a checklist for surviving a course.

**Seven collapsible sections:**
- **What BLC actually is** — NCOPDS first gate, branch-immaterial, DA 1059 outcomes, Commandant's List (20 pts) and DHG (40 pts), and the 150-point BLC bonus
- **Before you go — the unglamorous half** — because most BLC problems are administrative, not academic: ATRRS reservation, current AFT, AR 600-9 standard (noting the rescinded exemption), no flags, academy-specific packing list, AR 670-1 uniform
- **The academic load** — the two graded written products that cause the most failures, Army writing style per AR 25-50, ADP 6-22, TC 7-22.7, ATP 6-22.1, TC 3-21.5
- **Leadership evaluation — what cadre are actually watching** — framed as behaviours, not checkboxes: taking the hard job, correcting privately rather than performing the correction, owning squad failure
- **Sharpen the sword** — eight things that need no slot and no permission, startable this week
- **If you are a Corporal** — CPL is an NCO rank and the standard applied is different, fairly or not
- **After BLC** — verify the 1059 reached iPERMS, confirm the 150 points landed in IPPS-A, ask for a job you are not quite ready for

**A 10-item readiness self-check** with a live progress bar, persisted to IndexedDB (`guidon:blc:checks:v1`) so it survives reloads, plus cross-links into Board Drill, Counseling, Army Writing and the PPW worksheet.

**Verification:** BLC module loads, all seven sections expand, self-check persists across reload (5/10 confirmed after reload), section appears in the Leadership nav group; both corrected fitness cards confirmed serving the new text at runtime; `node --check` and CSS brace-balance clean; **0 accessibility violations across 3 themes × 9 sections**; zero console errors or warnings; zero overflow at 360px.

New build saved as `guidon_56.html`.

## 2026-07-23 (session 23) — Promotion points rebuilt to current AR 600-8-19; full PPW worksheet added (guidon_52.html → guidon_54.html)

**Ask:** build the corrected promotion points calculator, and a PPW (Promotion Point Worksheet) calculator.

**Context:** session 22's research found the existing calculator was structurally outdated — single flat caps, a 150-point "board score" category that no longer exists, and ACFT rather than AFT. This session implements the fix.

**Rebuilt against AR 600-8-19 (current edition effective 6 Apr 2026), with rank-aware caps.** The single most-missed detail is that **SGT and SSG have different maximums**, so the same Soldier scores two different totals:

| Category | SGT (E-5) | SSG (E-6) |
|---|---|---|
| Military training (weapons + AFT) | 280 | 230 |
| Awards, decorations & achievements | 145 | 165 |
| Military education | 240 | 245 |
| Civilian education | 135 | 160 |
| **Total** | **800** | **800** |

**Removed the board-score category.** Leadership points were removed from the semi-centralized system — SSG boards now use a Yes/No validation vote, SGT boards are administrative points only. What replaced it is a **+150 point BLC/ALC graduate bonus that sits outside the 800 ceiling**, now modelled correctly as an add-on rather than a category.

**Two modes, one calculator:**
- **Quick estimate** — four category inputs, for when you have your PPW in front of you.
- **Full PPW** — line-by-line, mirroring the real worksheet: weapon hits, AFT points, permanent awards, combat-zone months, resident ATRRS weeks, correspondence hours, PME honours, Ranger/SF/Sapper, semester-hour points, degree, credentials, CLEP/DANTES, DLPT.

**Rules now modelled correctly** (each verified in session 22's research): weapons are **hit-count** scored not badge scored, valid 24 months; **AFT points are entered directly (0–120), not derived from raw score** — the app explicitly warns that score ÷ 5 is wrong (a 500 is worth 80, not 100), because IPPS-A does that conversion itself; combat zone 2 pts/month capped at 30 SGT / 60 SSG *inside* the awards cap; resident training 4 pts/week; correspondence 1 pt per 5 hours, whole courses only; Commandant's List 20 / DHG 40; Ranger/SF/Sapper 40; degree +20; credentials capped at 50 (15 MOS-enhancing / 10 professional / 5 personal); CLEP-DANTES 2 pts per credit hour; DLPT 1/1 = 25.

**Deliberately not guessed:** the per-credit-hour rate for civilian semester hours was not verified in the research, so the worksheet takes that figure as a direct entry from your PPW rather than inventing a rate. Weapon hit-counts are interpolated between the two published anchor values (23 hits and 40 hits) and labelled as an estimate rather than fabricating unverified table rows.

**Found and fixed while building: two calculators disagreeing.** A second, older points calculator lives in the profile view and was still reading the outdated seed data — so the app would have given two different answers for the same Soldier. Corrected the seed to the current AR caps, removed the board-score category from it, labelled it explicitly as SGT caps, and added a **"→ Full PPW worksheet"** button pointing at the rank-aware one. One source of truth.

**Coaching is now gap-driven** rather than threshold-driven: the panel names the category where the most points are being left on the table and says what to do about it, and always surfaces the BLC/ALC bonus as the largest single lever. The cutoff-score note explains that cutoffs are published monthly per MOS and set by manning — with the 24 (everyone promotes) and 798 (no promotions) codes explained — **without hardcoding any perishable numbers**.

**Verification:** math checked against hand-computed expectations, not just rendering — 40/40 hits + 120 AFT correctly maxes training at 280 (SGT) and 230 (SSG); 20 combat-zone months correctly caps to 30 for SGT but shows 40 for SSG; 500 correspondence hours correctly caps to 90; quick-mode over-entry clamps to the category max; the BLC bonus correctly lands outside the 800 ceiling (280 subtotal → 430 total). `node --check` and CSS brace-balance clean; **0 accessibility violations across 3 themes × 9 sections** (now including `#/profile`); zero console errors or warnings; zero overflow at 360px and 1280px.

New build saved as `guidon_54.html`.

## 2026-07-23 (session 22) — Account management made prominent; optional name with a call-sign roulette (guidon_50.html → guidon_52.html)

**Ask:** a prominent, obvious way to switch/rename/delete accounts and reset the onboarding; allow staying anonymous (rank without a name); a random-name roulette in the name field; and retire "SOLOMON" as the placeholder.

**1. Account panel — moved to the top, four distinct actions.** Previously the only controls were two small ghost links buried at the *bottom* of the profile view, one of which ("⇄ Switch account / mode") silently **deleted** the profile — a misleading label for a destructive action. Replaced with a bordered **Account** panel as the first thing on the profile screen, showing the current name and mode, with four clearly-separated full-size buttons:
- **✎ Rename** — edits identity only; **verified to preserve the action plan** (6 items before and after). Leaving the field blank converts the profile to anonymous. Suggests a random call sign in the prompt.
- **↺ Redo my setup** — re-runs onboarding on the same account, for when priorities shift.
- **⇄ Switch account or mode** — genuinely starts fresh at the mode picker; confirm dialog now states plainly what is cleared and that study history stays on the device.
- **✕ Delete profile** — visually separated, **double-confirmed**. Verified: dismissing the second confirm leaves the profile fully intact.

Also added a **"👤 Manage account"** signpost in Settings → About. Settings is where people instinctively look for "change my name / start over", but the controls belong with the profile they act on — so it points there rather than duplicating them.

**2. The name is now optional — anonymity is a first-class outcome.** Nothing downstream needs a real name; rank and tier drive all guidance. With the field left blank the profile is identified by rank alone (`SPC`), flagged `anonymous`, and the Account panel says so explicitly ("rank only, no name stored") rather than showing something that looks like missing data. This matters on a shared or unit-issued device.

**3. Call-sign roulette.** A 🎲 button beside the name field spins one of 34 Army call signs, with a guard against repeating the previous spin. The roster is deliberately **affectionate rather than cutting** — these are names Soldiers give each other, not ones used to put somebody down. Anchored in real usage: *Snuffy* and *Joe* are the classic generic-Soldier stand-ins (GI Joe = "Government Issue Joe"); *Schmuckatelli* and *Snafu* are the same joke from other eras; *Dogface* was the self-appointed WWII infantry nickname. Terms that mock new or failing Soldiers (Cherry, Boot, Bolo) and the cruder barracks acronyms were left out on purpose.

**4. "SOLOMON" retired** — the name-field placeholder is now `e.g. SNUFFY — or leave blank`, which also advertises that blank is allowed.

**Bug found while testing — and it wasn't mine.** Adding an a11y sweep of `#/profile` (never previously audited — earlier sweeps covered 8 other sections) surfaced a **pre-existing** failure: `.ob-avatar` hardcoded `color:#000` on an `--amber` fill, giving black-on-olive at **2.55:1** on field-manual and the other deep-accent themes. Same class of bug as the session-11 button-ink issue. Repointed to the per-theme `--btn-ink` token. My first instinct was that my new red Delete button was the culprit; the axe output said otherwise, which is why the selector was checked before anything was "fixed".

**Verification:** all three name paths (blank / dice / typed) produce correct profiles and topbar names; rename, rename-to-anonymous, cancelled-rename and the delete double-confirm guard all verified live; `node --check` and CSS brace-balance clean; **0 a11y violations on Profile and Settings across 4 themes** (was 3), 0 across the earlier 3-theme × 8-section sweep; zero console errors or warnings; zero overflow at 360px and 1280px; all three onboarding modes intact.

New build saved as `guidon_52.html`.

## 2026-07-23 (session 21) — Board date bound to the profile, with a countdown/date display choice (guidon_48.html → guidon_50.html)

**Ask:** be able to input a board date, with the option to show it as a live countdown or simply as a date, tied to the chosen profile.

**What already existed (checked before building):** a board-date input and countdown banner on Board Prep, storing `boardDate` in global settings. Two things were genuinely missing — it wasn't bound to the profile, and there was no display choice.

**1. Display mode — countdown or plain date.** New `boardDateDisplay` setting (`countdown` | `date`) with a one-tap toggle in the banner itself. Countdown shows `45 · days to your board · Sun, Sep 6, 2026`. Date-only leads with the date and relegates the day-count to a quiet sub-label — a live countdown is motivating for some people and stressful for others, so it's a choice rather than a default assumption. The urgency colour (red ≤3 days, amber ≤14, green beyond) is kept in both modes.

**2. Bound to the chosen profile.** `boardDate` and `boardDateDisplay` now sync into the profile record alongside `etsDate`/`tier`/`retirementSystem`, and the countdown reads **profile-first, settings-as-fallback**. A personal profile keeps its own board date and display preference; guest and kiosk sessions are unchanged. Added a synchronous `G.profile.cached()` accessor because the countdown renders synchronously and must not await mid-draw.

**3. Found while building: the board date was invalidating the action plan for nothing.** Wiring `boardDate` into the profile-sync hook meant it inherited the plan-invalidation behaviour — but `generateActionPlan` never read `boardDate`, so changing the date wiped a good plan and regenerated an identical one. Rather than special-case it away, made the board date **actually drive the plan**, which is the more useful resolution:
- **≤7 days:** run a full Mock Board today, drill only weakest categories, plus final uniform/packet/DA 3355 checks (both high priority)
- **≤30 days:** daily Board Cards, weekly Mock Board, recheck promotion points while there's still time to close a gap
- **beyond 30:** build the habit now — short daily sessions beat cramming

Verified live: plan goes 6 → 8 items at 5 and 20 days out, 7 items at 120 days, with the wording scaling to proximity. Display-mode changes are cosmetic and deliberately **never** invalidate the plan.

**Verification:** set a date 45 days out, toggled both directions, reloaded — the chosen mode and date persisted to the profile and survived reload; toggling back worked. `node --check` and CSS brace-balance clean; contrast still 0 across the three warm themes × 8 sections; zero console errors or warnings; zero overflow at 360px and 1280px; all three onboarding modes re-verified (Personal 6 / Guest 0 / Kiosk 3).

**Process note:** an early search for the existing board-date code matched inside the embedded 3,592-term acronym dictionary and dumped thousands of lines — the same wasteful mistake made in session 14. Narrower, anchored patterns are required when grepping a single-file app with a multi-megabyte inline data blob.

New build saved as `guidon_50.html`.

## 2026-07-23 (session 20) — Onboarding/profile audit: found and fixed a bug that silently wiped every new user's action plan (guidon_47.html → guidon_48.html)

**Ask:** verify the onboarding modal, name/rank capture, and the whole profile/account-driven guidance chain are intact after the branch merge.

**Verified intact end-to-end (driven live, not read):** onboarding modal fires on a genuinely fresh profile; all three modes offered (Personal Account / Guest Session / Kiosk-Demo); the 5-screen flow runs Mode → *Who are you* (1/4) → *Your role* (2/4) → *What's on your mind* (3/4) → *What do you need to work on* (4/4) → action-plan summary; rank picker maps correctly through `RANK_TO_TIER` (SGT→E5, SSG→E6); display name composes as rank + last name; profile persists to IndexedDB and **survives reload without re-prompting**; topbar username populates; `userName` syncs to settings; MOS pre-fills the Career Center; Home greets by name and surfaces the plan. Guest and Kiosk paths both complete correctly and `isGuest()` reports accurately.

**The bug: every new personal profile had its action plan deleted the moment it was created.** Symptom — a profile that selected 3 readiness concerns and 3 study weak points saved with `actionPlan: []`, while Kiosk mode (which selects nothing) saved 3 items. Backwards.

Bisected with the app's own instrumentation rather than by guessing: the onboarding summary screen reported **"6 items built from your answers"** and rendered 11 plan rows, proving `generateActionPlan` was healthy and the stored keys were correct (`concerns: ['board','promotion']`, `weak: ['army values','lrm']` — exactly the values the generator matches on). So the loss had to be downstream. Hooking `G.db.put` to log every write to the profile key gave the answer directly:

```
saveProfile        → wrote plan: 6   ✓
store.setSetting   → overwrote plan: 0
store.setSetting   → overwrote plan: 0
```

**Root cause — sound intent, wrong sequencing.** `setSetting` deliberately clears `actionPlan` when `etsDate`, `tierFilter` or `retirementSystem` change, so a stale plan regenerates. But the onboarding save handler calls `setSetting` for **all three of those keys immediately after** saving the freshly-built plan — so the invalidation fired on values that hadn't actually changed, wiping the plan every time. Guest and Kiosk escaped only because they never call `setSetting`.

**Fix 1:** invalidate only on a *real* change — compare the incoming value against what's already on the profile before clearing. Preserves the original intent (stale plans still invalidate when someone genuinely changes their tier or ETS date) while making the onboarding no-op writes harmless.

**Fix 2 — a second defect found while fixing the first.** The invalidation comment promised the plan "will regenerate on next view." It never did: `renderProfileView` only ever read `profile.actionPlan || []`. So *any* legitimate invalidation also left the plan permanently empty until the person happened to find the manual "↺ Regenerate plan" button. Added real regeneration when the plan is empty — which makes the promise true and **self-heals profiles already saved with an empty plan**.

**Verified after fix:** the same `db.put` trace now shows `plan: 6` on all three writes and a final saved plan of 6. Re-ran all three onboarding modes — Personal 6 / Guest 0 (correct: guests have no persisted plan by design) / Kiosk 3. Contrast still 0 across the three warm themes × 8 sections; zero console errors *or warnings*; zero overflow at 360px and 1280px; `node --check` and CSS brace-balance clean.

**Instrument errors this session: two more.** An initial visibility probe reported the onboarding modal missing — it used `offsetParent !== null`, which is always `null` for `position: fixed` elements, and the overlay is fixed. A later walkthrough reported the flow "stuck" — the click selector was matching a wrapper element that also contained the card's text, and a subsequent run stopped one screen early because the loop had 4 iterations for a 5-screen flow. All three were test defects; the app was correct each time. **Running total across the project: the test has now been the wrong thing on five separate occasions.**

New build saved as `guidon_48.html`.

## 2026-07-23 (session 19) — Branch merge: reconciled a parallel fork, then fixed what neither branch had caught (guidon_46.html → guidon_47.html)

**Ask:** merge the work from a second, parallel chat into one line, then audit / fix / harden / enhance / polish.

**First finding: the project had silently forked.** Two chats both continued from `guidon_40.html` and each ran their own sessions 13–14, producing two different `guidon_41`/`guidon_42` files. Both independently did accessibility and contrast work — the Risk/Money/Author unlabeled-control fixes and the `qz-back-scroll` keyboard fix were done *twice, separately*. The other branch then went much further on features (sessions 15–18: card dedup, difficulty tiers, 4-level grading, Progress mastery, nav persistence, the `db`-import fix), so **`guidon_46.html` was correctly adopted as the base** and this session ported forward only what was genuinely unique to the other line.

**Second finding — and the reason the merge was worth doing: `guidon_46` still carried a real, measurable bug that this branch had already diagnosed and fixed.** The stale `.nav button:nth-child(4/11/16/17)` rule — written for the pre-session-4 flat nav, and left behind when the nav was reorganized into collapsible groups — was still live. After the DOM reorder it no longer targets Author/Settings; it now lands on the **Career and Author nav buttons and the `.nav-group-header` elements**, dimming them to `opacity: 0.72`. Measured with axe-core against the running app, this single dead rule accounted for **37 of the 50 remaining contrast violations (74%)**, at ratios as low as **2.93:1**. Removed.

**Ported forward from the other branch (each closing an item on this branch's own open list):**
- **`--ink-*` text-safe accent tokens** (`--ink-amber/green/red/cyan/violet`, a 60/40 `color-mix()` blend toward `--text`). Raw accent tokens are tuned for backgrounds and borders, not body text; used as text they fail on the warm themes. Repointed the Train competency/difficulty chip maps, the scenario difficulty badges, and `.tabBtn.active` — which covered the remaining 13 violations.
- **Inline web app manifest** — was open item #5 ("still not done"). Added as a `data:application/manifest+json` URI reusing the existing inline SVG favicon, so installability ("Add to Home Screen", standalone display, proper icon) works without breaking single-file distribution.
- **`APP_VERSION` constant + Settings "About" panel** — closes the long-standing "no single version marker" item. `window.GUIDON_APP_VERSION` is now `1.1.0`, surfaced in-app with build date and a plain-language offline/privacy line.

**Measured result: 50 → 0 contrast violations** across the three flagged warm themes (field-manual, desert-cadence, sepia-study) × 8 sections. Zero console errors, **zero console warnings**, zero overflow at 360px and 1280px.

**Third: acted on open item #1 — spot-checked the 93 heuristically-classified Expert cards.** Extracted and read all 93. The heuristic is broadly sound but has a clear failure mode: it over-weights *category* (LOAC, UCMJ, Financial Readiness, Supply & Property are treated as inherently expert) and therefore mis-tiers simple definitional questions inside those categories. Reclassified 6 unambiguous cases — `What does CBRN stand for?`, `What acronym describes the CRM five-step process?` and `What are the General Orders of a sentry?` to **beginner** (pure acronym expansion / basic-training recall); `What is BAS?`, `What is the difference between leave and a pass?` and `What is a Commander's Intent?` to **intermediate**. New distribution: **beginner 327 / intermediate 600 / expert 87 = 1,014** — total preserved, deliberately conservative, nothing deleted.

**Fourth: attempted a broader duplicate re-scan — and the scan itself was wrong.** Session 16's dedup used a 0.82 similarity threshold with hand-verification of every match. To test whether that under-caught, this session ran a looser token-normalized scan, which reported "84 clusters / 204 cards involved." **That number is not trustworthy and was not acted on.** Inspection of the output showed it clustering on *sentence template* rather than meaning — it grouped `General Order Number 1 / 2 / 3` as duplicates of each other, likewise `Class 1 / 2 / 3 leak`, and lumped together every `What is the difference between X and Y?` card regardless of topic. **Session 16's stricter methodology was correct; this session's scan was the defective instrument.** No cards were removed on its say-so. There does appear to be a genuine residual cluster around *Commander's Intent* (roughly 5 overlapping cards) worth a human look, but that is reported, not auto-resolved.

**Fifth: two of this session's own verification results were false negatives, caught before acting on them.** An initial check reported the Progress "Board Drill Mastery" panel missing and nav-group persistence not working. Both were test artifacts: the Mastery panel is correctly gated on having graded cards (it renders properly once 6 cards are graded), and nav state persists under the key `guidon-nav-open-groups`, written on toggle. Neither was touched. **This is the third separate occasion in this project where the test, not the app, was the broken thing** — see also session 18 (console filter dropping `warning`) and session 13 (harness setting `data-theme` without `html.light`).

**Verification:** `node --check` clean on all inline scripts; CSS brace-balance clean across all 3 style blocks; live axe-core sweep 50→0; manifest confirmed loading; `APP_VERSION` and About panel confirmed rendering; Board Drill deck confirmed at 1,014 with the Level filter intact; Progress Mastery + Board Q Readiness panels both confirmed rendering with real graded data; zero console errors *or warnings* throughout.

New build saved as `guidon_47.html` — now the single, unforked source of truth.

## 2026-07-20 (session 18) — Found and fixed the actual reason Progress never showed Board Drill data (guidon_45.html → guidon_46.html)

**Ask:** finish wiring the new grading system into Progress (narrower follow-up to session 17's broader review).

**The real bug, finally found.** Session 17 shipped a "Board Drill Mastery" panel and removed a suspected blocking early-return, but the panel still never rendered. Re-testing today with the console **warning** channel captured (not just `error`) — a filtering mistake in the last two sessions' test scripts that had been silently hiding the actual signal — immediately surfaced the true cause: `ReferenceError: db is not defined`. The Progress module's IIFE only ever imported `util` and `store` from the global `G` object (`const util = G.util, store = G.store, el = util.el;`) and never imported `db`, even though its "Board Q Readiness" per-category panel — which **predates this entire project's session history** — has always called `await db.get(...)` directly. Every read silently threw, was caught by a `catch(e) { console.warn(...) }`, and both that pre-existing panel and this session's new Mastery panel quietly failed every single time, with no visible error to anyone not specifically listening for console warnings.

**Fix:** one-line — added `db = G.db` to the module's existing destructuring line, matching the pattern already used correctly in every other module in the file.

**Verified, not assumed:** graded 8 Board Drill cards across all 4 grade levels, navigated to Progress, and confirmed both the new "Board Drill Mastery" panel (per study level: Beginner/Intermediate/Expert, real numbers) and the pre-existing "Board Q Readiness" per-category panel now render with live data — the latter apparently for the first time ever, in any session on record. Re-ran the full 18-section regression sweep capturing both `error`-and`warning`-level console output this time: zero overflow, zero errors, zero warnings anywhere.

New build saved as `guidon_46.html` (4.95 MB) — now the current source of truth.

## 2026-07-20 (session 17) — Team review: connected the new grading system to Progress, fixed a pre-existing dormant bug (guidon_44.html → guidon_45.html)

**Ask:** a multi-angle team review of the app plus a fresh read of the handoff docs, strong recommendations, then implement them all and harden/polish what's touched.

**Found: the 4-level grading + difficulty tiers from session 16 were invisible everywhere outside Board Drill itself.** The Progress tab — the actual "how am I doing" page — had no connection to any of that new data. Added a **"Board Drill Mastery" panel** to Progress, broken out by study level (Beginner/Intermediate/Expert), showing Down-Cold/Know-It coverage as a share of graded cards per tier.

**Found while wiring that in: a real, pre-existing bug**, not introduced this session — Progress had a hard early-return that hid *all* card-progress content (including the pre-existing per-category "Board Q Readiness" panel) unless the person had completed at least one Train scenario. A Soldier who only uses Board Drill flashcards saw a blank page regardless of how much flashcard work they'd done. **Confirmed pre-existing** by reproducing the identical gap against yesterday's build (`guidon_43.html`) before making any change. Fixed by removing the blanket early return — the sections that actually need scenario data already guard themselves individually.

**Also fixed:** nav sidebar group open/closed state (flagged since session 4, never addressed) now persists across reloads via `localStorage`.

**Explicitly scoped out, with reasoning:** lazy-loading the ~5MB embedded seed data (real architectural surgery, deserves its own dedicated session); extending 4-level SRS grading to Quiz Mode/Mock Board (different interaction paradigm — multiple-choice testing doesn't need flashcard-style grading); the web app manifest (still valid, still not urgent).

**Verification:** `node --check` passes; brace-balance clean; full regression sweep across 18 sections: zero overflow, zero console errors; Guided Tour re-verified working; new mastery-panel logic confirmed sound via direct IndexedDB inspection of `lastGrade`/`difficulty` fields (will render correctly now that the gating bug is fixed); nav persistence verified via `localStorage`.

New build saved as `guidon_45.html` (4.95 MB) — now the current source of truth. New deliverable: `GUIDON_TEAM_REVIEW.md`.

## 2026-07-20 (session 16) — Board card audit + difficulty tiers + 4-level mastery grading (guidon_43.html → guidon_44.html)

**Ask:** audit all 1,031 board cards for duplicates, separate them into beginner/intermediate/expert (by-the-book verbatim) study levels, and upgrade the flip-card grading into a 3–5 level mastery system with a bookmark deck.

**Duplicate audit — 17 confirmed duplicates removed (1,031 → 1,014).** Ran exact-match and fuzzy-match (SequenceMatcher, 0.82 threshold) comparison across every question, then manually verified every candidate against its actual answer content before removing anything — several high-similarity pairs (e.g. "What is ADP 3-0?" vs "What is ADP 6-0?") were confirmed as legitimately different questions and correctly kept. One removed pair had outright conflicting answers to the identical question (three types of developmental counseling), and one was mislabeled "seven principles" while listing six — both data-quality issues, not just duplication. Full before/after table in the new `GUIDON_BOARD_CARD_AUDIT.md`.

**Difficulty classification added to all 1,014 remaining cards** — none had one before. Built a transparent, documented heuristic (category type, answer length, key-point count, question phrasing) rather than hand-grading 1,014 cards individually, which wasn't feasible in one pass: 324 Beginner, 597 Intermediate, 93 Expert. A **Level filter** now sits next to the existing Category filter in Board Drill.

**"Expert" ties to verbatim recall, not just a label**: Expert-tier cards now flip to show the **By-the-Book verbatim answer first**, ahead of the friendlier paraphrase — holding yourself to word-for-word doctrine rather than the acceptable-answer shortcut. Beginner/Intermediate keep the paraphrase-first order. Each card also shows its tier as a small colored badge on the front, before you even flip it.

**Binary grading replaced with a 4-level mastery system**: "Got it / Review again" is now **Needs Help 🆘 / Somewhat 📖 / Know It ✓ / Down Cold 🏆**, each driving its own spaced-repetition interval (`schedule()` rewritten to accept a 0–3 grade instead of a boolean, with a distinct ease/interval curve per level). Selectable via the four on-card buttons, the existing swipe gesture (right = Know It, left = Needs Help — the two most common outcomes), or new 1–4 number-key shortcuts.

**Bookmark deck clarified**: the existing star system (added session 9) is now labeled "⭐ My Bookmarks" to make explicit that it's a personal, filterable saved-card deck, not just a marker.

**Bug found and fixed during testing**: none this time were app bugs — one Playwright timing flake during testing turned out not to reproduce on retry, confirmed via a clean re-run rather than assumed fixed.

**Verified:** `node --check` passes; brace-balance clean; data-splice verified via `node -e` round-trip (1,014 questions load correctly, difficulty distribution confirmed, unrelated seed data — 3,592 acronym terms — confirmed untouched); full regression sweep across 4 viewports × 18 sections: zero overflow, zero console errors; axe-core check on the flipped card back: zero violations; all 4 grade buttons, keyboard 1–4 shortcuts, difficulty filter, and bookmark filter individually tested end-to-end via script.

New build saved as `guidon_44.html` (4.94 MB) — now the current source of truth. New deliverable: `GUIDON_BOARD_CARD_AUDIT.md`.

## 2026-07-15 (session 15) — Quick full-app audit + hardening pass: contrast down 53% more (guidon_42.html → guidon_43.html)

**Ask:** a quick look-over of the entire app, fix/harden/polish everything, deliver a post-audit report + updated build.

- Re-ran the full axe-core sweep (18 sections × 14 themes, 252 combinations) to see exactly where things stood after session 14's fixes: 104 contrast violations remaining, zero non-contrast issues.
- **Found the actual root cause behind the remaining cluster**: a repeated pattern of using raw accent colors (`var(--amber)`, `var(--red)`, `var(--cyan)`, etc.) as text color, or blending them only 65% toward the base text color — safe-looking in the themes it was first tested against, not safe across all 14. Strengthened every instance from 65%→40% blend weight in one pass (14 call sites: Train's difficulty/competency badges, search-filter chips, danger buttons, nav active-state, and the nav sidebar's base text color) and verified empirically against axe rather than trusting the math alone.
- **Result: contrast violations dropped from 221 to 104** (a 53% reduction this session; 77% cumulative from the original 443). Remaining ~104 are minor near-misses concentrated in 3 warm-toned themes (desert-cadence, sepia-study, field-manual) — logged as a tracked follow-up, not chased further given diminishing returns on a "quick" pass.
- **Re-verified nothing broke**: full 19-stop Guided Tour walkthrough (including the back-navigation resume fix from session 14) still correct; Board Drill flip card, star, and keyboard shortcuts still correct; zero layout overflow or console errors across 4 viewports × 18 sections.
- New deliverable: `GUIDON_POST_AUDIT_REPORT.md` — a concise before/after summary (shorter than session 10's full proposal, matching the "quick audit" scope of this request).

New build saved as `guidon_43.html` (4.95 MB) — now the current source of truth.

## 2026-07-14 (session 14) — Pre-demo hardening pass: fixed a real Demo Center bug, closed remaining audit gaps (guidon_41.html → guidon_42.html)

**Ask:** audit for remaining gaps and hardened components ahead of showcasing the app to people same-day, without breaking anything already built.

**Real bug found and fixed — Guided Tour lost its place on back-navigation.** Simulated the exact thing a presenter would do today: start the Guided Tour, tap "Open →" on a stop, then press back to return to the tour. Found that doing this reset the tour all the way to step 1 instead of resuming — because `renderKioskMode` re-runs fresh on every visit to `#/kiosk`, and the tour's step position lived only in a local variable with no persistence. Fixed by persisting the current step to `sessionStorage` (mirroring the existing pattern used for the guided/free mode choice), cleared appropriately on "choose a different mode," "end tour," and fresh kiosk re-entry so a new visitor doesn't inherit a stale position. **Verified by walking the entire 19-stop tour end-to-end via script** (open → back → confirm resume, repeated for all 19) — all correct, zero console errors.

**Closed the remaining items from session 11's audit:**
- Risk Assessment worksheet: fixed 5 unlabeled text/date inputs and 8 unlabeled selects (same disconnected-`<label>` pattern as Settings, fixed the same way).
- Money page: fixed 5 unlabeled calculator inputs (Match-capture, Compound-growth projector, 50/30/20 allocator) with descriptive `aria-label`s.
- Author page: labeled the "copy a built-in scenario as template" select.
- Board Drill flip card: made the scrollable answer region keyboard-focusable (`tabindex="0"` + `role="region"`), closing the last `scrollable-region-focusable` gap.
- **Result: zero non-contrast WCAG A/AA violations anywhere** — verified across all 18 sections × 14 themes (252 combinations).

**Contrast: closed one more systemic gap, found via the .hint fix's ripple effect.** `.hint` (used for helper text on nearly every screen in the app) was using `--text-mute`, which fails 4.5:1 in 12 of 14 themes — bumped to `--text-dim`, the same fix already proven safe on other components this session. Also found and fixed a borderline nav-button case (the Develop/Risk sidebar icons sat right at ~4.5:1 by flat-color math but failed axe's stricter anti-aliased-pixel sampling); gave nav button text a small extra contrast margin via `color-mix()`. **Total contrast violations dropped from 443 to 221** across the full 252-combination matrix — the remaining instances are scattered 1–6-count near-misses across several themes/pages, logged as a follow-up rather than exhaustively chased today given the time constraint.

**Verified not broken, not fixed as new bugs:** ran the full onboarding flow (Personal Account path: name → role → mood → focus areas → generated action plan → save) end-to-end via script — completes cleanly with zero errors. The validation toast ("Enter your last name to continue.") on the name step was initially suspected broken during testing but confirmed working correctly — a test-timing artifact, not an app bug.

**Verification:** `node --check` passes; brace-balance clean across all 3 style blocks; full regression sweep across 4 viewports (phone/tablet-portrait/tablet-landscape/desktop) × 18 sections: zero overflow, zero console errors; full 19-stop Guided Tour walkthrough with back-navigation at every stop: zero errors, correct resume behavior confirmed at each stop.

New build saved as `guidon_42.html` (4.95 MB) — now the current source of truth.

## 2026-07-14 (session 13) — Optimized for the Tab S9 FE's actual hardware: S Pen hover + 90Hz smoothness audit (guidon_40.html → guidon_41.html)

**Ask:** optimize for this specific tablet model and use its maximum capacity/capabilities, following on from last session's device verification.

**Researched what this device actually offers beyond generic "tablet":** the Galaxy Tab S9 FE ships with an included, pressure/tilt-sensitive **S Pen that genuinely hovers above the screen before touching it** (unlike a finger), and has a **90Hz adaptive refresh display**. Samsung DeX exists on this model but can't output to an external monitor (USB-C is USB 2.0 only, no video), so a desktop-mode-specific layout wasn't worth building — the existing ≥860px sidebar tier already covers windowed/DeX use adequately.

**S Pen hover support — a genuine hardware capability the CSS media-query system can't see.** `(hover: hover)` / `(pointer: fine)` media queries describe a device's *primary* pointer, which on this tablet is touch — so even though the bundled S Pen has true hover-above-glass detection, GUIDON's mouse-only hover-lift rule would never fire for it, and the pen would get no pre-touch feedback at all. Added JS-level detection via the Pointer Events API (`pointerType === 'pen'`) on the Board Drill flip card, giving S Pen users the same lift-and-glow hover feedback mouse users get — something a touch-only device could otherwise never show anyone. Verified with real dispatched `PointerEvent`s: pen hover correctly activates the feedback, touch correctly does not (kept properly scoped), and it correctly stops once a card is flipped or once committed.

**90Hz smoothness audit — confirmed already optimal, no changes needed.** Checked the flip card's transition (and everything chained to it): it animates only `transform` (fully GPU-compositable, zero layout/paint cost), which is exactly what's needed for a 90Hz panel to actually render every frame smoothly rather than being capped by main-thread work. No changes required here — this was already built correctly in session 9.

**Verified:** `node --check` passes; brace-balance clean; full 18-section sanity sweep at the device's real viewport (1152×720) shows zero overflow and zero console errors; S Pen hover behavior confirmed via dispatched `PointerEvent`s in all three states (hover-in, hover-out, and post-flip).

New build saved as `guidon_41.html` (4.95 MB) — now the current source of truth.

## 2026-07-13 (session 12) — Verified against a real device: Galaxy Tab S9 FE 5G (SM-X518U) — no changes needed

**Ask:** ensure compatibility, flexibility, and fluidity for the specific device shown in a screenshot (Samsung device-info screen: "Christopher's Tab S9 FE", model SM-X518U).

- **Researched actual hardware specs** rather than guessing: Galaxy Tab S9 FE 5G, 10.9" display, 2304×1440 physical resolution, Android 13 (One UI 5.1), Exynos 1380. Computed the real CSS viewport this device presents to a browser — Samsung tablets in this pixel-density class report a device pixel ratio of 2, giving **~1152×720 CSS px in landscape** and **~720×1152 in portrait**.
- **Tested at those exact dimensions** (not a rough approximation) via Playwright, with a matching Android 13/SM-X518U user agent, `is_mobile`/`has_touch` set to emulate the real touchscreen: both orientations, across all 18 sections.
- **Result: zero horizontal overflow, zero console errors, in either orientation.** Confirmed the device correctly lands in the two responsive tiers built in earlier sessions — landscape (1152px) gets the full desktop sidebar (≥860px tier), portrait (720px) gets the compact foldable/tablet sidebar (600–859px tier) — both appropriately sized for the device's actual 10.9" physical size.
- **Confirmed the device/input-mode auto-detection from session 6 correctly engages on this real hardware**: `matchMedia('(pointer: coarse)')` and `hover:none` both correctly report `true`, and nav buttons automatically receive their 48px touch-friendly sizing — with zero manual configuration, exactly as designed.
- Visually checked Home, the Quizlet-style Board Drill flip card, and the MOS Career Center in both orientations — all render cleanly with no layout issues.
- **No code changes were made this session** — the responsive/device-mode work from sessions 5, 6, 9, and 11 already generalizes correctly to this specific real device without modification. `guidon_40.html` remains the current build.

## 2026-07-13 (session 11) — Implemented the audit proposal: 2 root-cause bugs fixed app-wide, all critical a11y issues resolved (guidon_39.html → guidon_40.html)

**Ask:** implement the recommendations from the comprehensive audit (session 10), in priority order.

**Critical (§1.1) — all 12 unlabeled checkboxes + 2 unlabeled selects fixed.** Traced to three separate near-duplicate toggle-switch builder functions in Settings (`toggle()`, `toggleRow()`, and one standalone Reduce Motion checkbox) where the visible label text lived in a sibling `<span>` outside the actual `<label>` element — each now carries a proper `aria-label`. Also fixed the Board Drill category select, the Quiz mode category select, and the onboarding tier-filter select the same way. Verified via axe-core: zero `label`/`select-name` violations remaining on Settings and Board.

**High (§1.2, color contrast) — found and fixed two systemic root causes, not just symptoms:**
1. **The real bug behind most contrast failures:** `<meta name="color-scheme" content="dark">` was static, silently forcing native form-control text (e.g. unstyled `<button>` elements) to dark-mode defaults even inside the app's 5 light themes — this is what caused white text on light "readiness tile" backgrounds. Fixed by adding `html { color-scheme: dark; } html.light { color-scheme: light; }`, which overrides the meta tag per the app's own theme state (already set synchronously pre-paint). Also explicitly bound `.readiness-tile` to `var(--text)` rather than leaving it to the now-correct UA default, for exact theme-token consistency.
2. **A second systemic bug, specific to primary/accent buttons:** `.btn.primary` and ~8 other amber-background components hardcoded dark ink (`#1a1206`) assuming the `--amber` token is always a light/bright accent — untrue for at least 8 of 14 themes (including the default, field-manual) where the accent is a deep, muted color. Computed real WCAG contrast ratios (not a luminance heuristic, which was initially wrong for 3 themes) for both a dark-ink and light-ink candidate against every theme's actual `--amber` value, and added a new per-theme `--btn-ink` CSS variable so each theme's primary-button text is provably readable. Fixed 8 call sites app-wide (`.btn.primary`, `.segmented button.active`, `.skip-link`, `.grade-btn.active`, `.mb-cat-chip.on`, `.ob-rank-btn.active`, `.cpdf-modebtn.active`, and this session's own `.qz-nav-flip` + `#demo-mode-badge` button from earlier sessions).
3. Also fixed the `.nav-group-header` opacity-multiplier bug (session 4's own regression — dimming an already-dim inherited color pushed 13 of 14 themes below 4.5:1), the topbar subtitle (`--text-mute` → `--text-dim`), desert-cadence's own slightly-too-light `--text-dim` token, and two raw-accent-as-text instances (nav active-item color, home-screen urgency count) by blending them with the guaranteed-readable `--text` color via `color-mix()`.
4. **Result:** color-contrast violations on Home dropped from 67 (before this session) to 0 across 13 of 14 themes, with only 2 minor items remaining in desert-cadence specifically (documented as a follow-up, not silently left unfixed elsewhere).

**Serious (nested-interactive) — fixed both instances found:** the Quizlet flip-card's outer container (already fixed in session 10) and a previously-undiscovered second instance — the home-screen "board cards due" panel had a `role="button"` div wrapping a real, separately-clickable `<button>Start drill</button>`. Removed the redundant outer role/handlers since the real button already covered the interaction.

**Extended the axe-core sweep to all 18 sections × 14 themes** (252 combinations) as recommended — this surfaced substantially more findings than the original 8-section sample (443 contrast + 297 other violations before this session's fixes), concentrated in Risk (unlabeled worksheet fields), Money/Author (unlabeled selects), and Train (card/tag/chip contrast in the remaining edge-case themes). Fixed the highest-leverage, most systemic items above; the remaining scattered instances are logged as open items rather than exhaustively chased in one sitting.

**Verification:** `node --check` on all inline scripts passes; brace-balance clean across all 3 style blocks; final sanity sweep across all 18 sections confirms zero horizontal overflow and zero console errors.

New build saved as `guidon_40.html` (4.94 MB) — now the current source of truth.

## 2026-07-13 (session 10) — Comprehensive PC/mobile audit + proposal; one a11y fix (guidon_38.html → guidon_39.html)

**Ask:** a comprehensive proposal of further improvements, based on an actual audit across PC and mobile configurations.

- **New deliverable:** `GUIDON_AUDIT_PROPOSAL.md` — a standalone one-time audit document (not one of the 3 canonical handoff files), covering accessibility, performance, mobile-specific UX, PC-specific UX, and a consolidated list of previously-flagged data-freshness items, each tagged by scope/priority/effort.
- **Methodology, not just opinion:** ran a real WCAG 2.0/2.1 A+AA audit via **axe-core 4.12.1** injected into the live app via Playwright, across 8 of 19 sections. Findings: 12 unlabeled checkbox inputs + 2 unlabeled `<select>` elements (Settings, Board Drill) — critical; 79 color-contrast failures across 8 sections in at least one theme — serious; 2 nested-interactive-element violations on the new flip card — serious.
- **Fixed on the spot:** the nested-interactive violation, since it was a clear, contained regression from this session's own Quizlet flip-card work (§13) — `.qz-card` no longer carries a redundant `role="button"` now that its keyboard handling lives on the card's container. Re-ran axe-core to confirm the violation is gone.
- **Deliberately not fixed without sign-off:** the unlabeled-controls and color-contrast findings are real but are recommendations in the proposal document, not silently patched — contrast in particular needs a proper per-theme pass (changing shared `--text-dim`-style tokens globally risks new regressions in other themes), which the proposal flags explicitly rather than rushing.
- Also flagged in the proposal: the ~4.94MB single eager-parsed `GUIDON_SEED` payload as a performance consideration for older/budget Android devices (not measurable on this session's fast test machine, but a known class of risk), and the lack of a web app manifest for "Add to Home Screen" polish.
- New build saved as `guidon_39.html` (4.94 MB) — now the current source of truth. The only functional change from `guidon_38.html` is the one-line nested-interactive fix.

## 2026-07-13 (session 9) — Board Drill rebuilt as a Quizlet-style flip-card system (guidon_37.html → guidon_38.html)

**Ask:** convert the study-cards section (Board Drill) into a Quizlet-style flashcard system — responsive, dynamic, with the polish that format requires.

- **True 3D flip card** replaces the old "Reveal Answer" click-to-expand-below pattern: tap/click the card (or press Space/Enter) and it physically flips in place via a `perspective`/`rotateY(180deg)` transform, front (question) to back (full answer). All existing rich content on the back is preserved exactly — Acceptable Answer, By-the-Book verbatim doctrine answer, key points, and cross-links to related Doctrine entries/scenarios.
- **Slim deck-progress bar** above the card (Quizlet-style), replacing/supplementing the plain "Card 3/40" text tally.
- **Shuffle button** — reshuffles the current filtered deck on demand, independent of the existing automatic due/leech-weighted shuffle.
- **Star/bookmark system** — a star icon on every card (top-right corner, doesn't trigger a flip) persists to the same per-card record as the spaced-repetition data; a new "⭐ Starred" filter chip appears next to the existing Due/Leech chips once at least one card is starred.
- **Deck-browsing nav row** (‹ Prev / ⤾ Flip / Next ›) — lets someone browse the stack without grading, separate from the swipe-to-grade gesture (which still only activates once a card is flipped, unchanged from before).
- **Keyboard shortcuts**, scoped to the card container (not global, so they never fight with typing elsewhere): Space/Enter flips, ←/→ browse, G/1 = Got it, R/2 = Review again (both only once flipped).
- **Fully responsive card sizing** via `clamp()` — the card height and prompt font size scale smoothly from phone through desktop, verified at zero horizontal overflow across 6 real viewport widths (344–1280px).
- **Motion-aware**: mouse/trackpad users get a subtle hover lift (`hover:hover and pointer:fine`); `prefers-reduced-motion`/the app's existing `data-motion="minimal"` setting skips the 3D rotation entirely and just swaps which face is visible, reusing the app's existing reduce-motion conventions rather than introducing a new one.
- **Theme-agnostic**: every color in the new CSS pulls from existing theme tokens (`--panel`, `--amber`, `--line`, etc.), so all 14 themes render it correctly with no extra per-theme work.
- **Verified interactively, not just by reading code**: used Playwright to actually click-to-flip, star a card, grade "Got it" (confirmed it advances to a new question and resets the flip state), and trigger the Space/Arrow keyboard shortcuts — all confirmed working with zero console errors. Also re-ran the overflow scan from session 8 specifically against `#/board` across all viewport tiers: zero overflow.
- New build saved as `guidon_38.html` (4.94 MB) — now the current source of truth.
- Scope note: the separate "Quiz" (multiple-choice) and "Mock Board" tabs were left untouched — this rebuild is specifically the "Board Drill" flashcard tab, which is what the study-cards request was describing.

## 2026-07-13 (session 8) — Real bugs found & fixed via actual rendering, not just code review (guidon_36.html → guidon_37.html)

**Trigger:** user shared a phone screenshot of the live app (Train screen, Kiosk Mode, ~360px-wide Android phone) showing visible overlap in the topbar and a stray element in the bottom nav. Rather than reason about this from code alone, this session used **Playwright + headless Chromium (already installed in the environment)** to actually load `guidon_36.html` and reproduce the exact scenario — picking Kiosk Mode, navigating to Train, at real phone widths — then inspected computed styles and bounding boxes to find true root causes.

**Bug 1 — topbar name-overwrite (pre-existing, not introduced this session):** three separate code paths (`boot userName sync`, `onboarding-complete callback`, `cached-profile-load on boot`) all wrote a person's full display name (e.g. "KIOSK MODE") directly into the profile button's `textContent`, silently replacing its 👤 icon with unconstrained text that overflowed past the viewport edge — this was the "KIOS/MOD" clipping in the screenshot. Fixed by adding a **separate, properly-constrained `#topbar-username` element** (own max-width, ellipsis, hidden entirely below 480px) and repointing all three writers to it. The profile button now always keeps its icon.

**Bug 2 — brand title overflow (pre-existing, not introduced this session):** the "GUIDON" `<h1>` was rendering ~58px wider than its container and visually overlapping the "Online" status chip. Root cause: the topbar's brand text is wrapped in an **unclassed `<div>`** that's itself a flex item of `.brand` (which is `display:flex`) — flex items default to `min-width:auto`, which silently blocks a child's `max-width`/ellipsis from ever taking effect, regardless of what's set on the child itself. This is a well-known flexbox gotcha and was invisible from reading the h1/small rules in isolation. Fixed with one rule: `.topbar .brand > div { min-width: 0; }`.

**Bug 3 — collapsible group headers in the mobile bottom rail (introduced in session 4's nav consolidation):** the "▾ Board Prep" group-header toggle button was rendering inline in the horizontal phone nav strip, between Home and Train — confusing, since real bottom tab bars (Material Design, iOS) are flat and scrollable, not accordions. Fixed by branching `renderNav()`: **flat, ungrouped list below 600px** (matching standard bottom-tab-bar conventions), collapsible grouped presentation only at the two sidebar tiers (≥600px) where it was actually designed for. A `matchMedia` listener re-renders the nav live if a resize crosses the 600px line (e.g. a foldable unfolding).

**Verification (not just code read-through):** used the environment's pre-installed Playwright/Chromium to render and screenshot the app across 6 real viewport widths (344/390/412/717/860/1280px, covering the Z Fold 5 cover screen through desktop) × all 18 sections, in Kiosk Mode. Confirmed via `getBoundingClientRect()`/`getComputedStyle()` that: the brand title no longer overflows (h1 right edge now ends before the status chip starts), the profile button is icon-only again, and the mobile nav renders flat. A scripted overflow scan (`document.documentElement.scrollWidth - window.innerWidth`) across all 108 combinations found **zero** horizontal overflow. `node --check` on all extracted inline `<script>` blocks passes; CSS brace-balance clean across all 3 inline `<style>` blocks.

New build saved as `guidon_37.html` (4.94 MB) — now the current source of truth.

## 2026-07-13 (session 7) — Demo Center: full Guided Tour + Free Mode (guidon_35.html → guidon_36.html)

**Ask:** a complete, end-to-end wired demo covering every section (as started in Kiosk Mode), with a choice between stepping through guided demos or exploring freely — usable both for the person themself and to showcase GUIDON to someone else.

- **Kiosk Mode is now a full "Demo Center"** (`#/kiosk`) with two explicit paths, chosen up front:
  - **Guided Tour** — the existing step-by-step walkthrough, expanded from 9 stops to **all 19 real sections** (Home, Train, Board, Doctrine, Terms, Learn, Forms, Write, Counsel, Develop, Risk, MOS Career Center, Money, Health, Transition/ETS, Resources, Progress, Author, Settings), each with a one-line explanation and an "Open →" button that actually navigates there. Progress dots, Prev/Next, and a "choose a different mode" escape hatch.
  - **Free Mode** — drops straight into the app at Home for self-directed exploring. A persistent **"DEMO MODE" badge with a one-tap Exit** appears in the topbar on every screen while this is active (new `G.kioskBadge` module), so a presenter — or whoever's holding the device — always has a visible way back out without hunting for it.
- **Wired end-to-end from onboarding**: picking "Kiosk / Demo Mode" during onboarding now lands directly on this Guided Tour / Free Mode picker (`location.hash = "#/kiosk"`) instead of silently landing on Home with just a 3-item action-plan stub. Onboarding's mode-card copy updated to describe both options up front.
- Free Mode's choice is remembered per-session (`sessionStorage`, not the profile) so a page reload during a live demo doesn't lose the badge; re-entering Kiosk mode fresh always re-asks Guided vs Free.
- Verified: `node --check` on all extracted inline `<script>` blocks passes; CSS brace-balance clean across all 3 inline `<style>` blocks; confirmed 19 Guided Tour stops and all new functions/module present via structural grep.
- New build saved as `guidon_36.html` (4.93 MB) — now the current source of truth.
- Known follow-up: Settings was included as the final tour stop for completeness ("all sections"), but it's arguably not a showcase piece — worth a look if the tour feels padded in practice.

## 2026-07-13 (session 6) — Device/input-mode auto-detection (guidon_34.html → guidon_35.html)

**Ask:** make the app as fluid/flexible as possible across devices/viewing methods, and let the UI adapt to device/mode, not just screen width.

- **Discovered and preserved:** the app already has a deliberate, accessible `data-text-scale` system (compact/standard/large/xlarge, user-controlled) for reading text — left untouched rather than replaced with viewport-based fluid type, since that would reduce the person's explicit control over reading size. Also discovered a prior session had already added a "Fold 5 unfolded/tablet" 768px breakpoint (`.panel-grid-2/3`, heading sizes, `.main` padding) — left in place; it's complementary to, not overlapping with, last session's 600–859px sidebar tier.
- **New: OS-level device-mode auto-detection**, mirroring the existing `prefers-reduced-motion` pattern (which already sits alongside a manual `reduceMotion` toggle) for three more manual settings that previously required the person to find them in Settings:
  - `@media (pointer: coarse)` → same 48px tap-target sizing as the manual "large targets" toggle, auto-applied on any touchscreen (phone, tablet, Z Fold in either fold state) — no setting hunt required.
  - `@media (hover: none)` → neutralizes the transform/shadow hover-lift on `.click`, `.panel`, `.card`, `.hotspot`, `.idp-suggest-chip`, `.readiness-tile`, `.topbar-search-btn` — fixes the common touchscreen bug where a tapped element's `:hover` state visually "sticks" until something else is tapped. Color/opacity hover feedback is untouched, and `:focus-visible` (keyboard users) is never touched by this.
  - `@media (prefers-contrast: more)` → same boost as the manual high-contrast toggle.
  - `@media (prefers-reduced-transparency: reduce)` → same solid-fill treatment as the manual reduce-transparency toggle.
- **Audited grid components** (`.score-grid`, `.idp-var-grid`, `.readiness-grid`, etc.) and confirmed they already use `repeat(auto-fit, minmax(Npx, 1fr))`, which responds to the grid's own rendered width (i.e. true available space — sidebar width included) rather than viewport width. This already solves the "fluid regardless of container" problem natively; no container-query migration was needed.
- Verified: `node --check` on all extracted inline `<script>` blocks passes; brace-balance confirmed clean across all 3 inline `<style>` blocks.
- New build saved as `guidon_35.html` (4.92 MB) — now the current source of truth.

## 2026-07-13 (session 5) — Cross-device responsiveness pass, incl. Galaxy Z Fold 5 (guidon_33.html → guidon_34.html)

**Ask:** ensure layout compatibility across modern devices/viewing methods, specifically PC ↔ mobile switching and the Galaxy Z Fold 5 (extreme-narrow cover screen ~344 CSS px wide when folded; near-square ~717–840 CSS px wide inner display when unfolded).

- **Safe-area-inset padding** added (previously absent — 0 occurrences in the file): topbar (top/left/right), main content (bottom/left/right), and both nav variants (mobile bottom rail + all side-rail tiers) now respect `env(safe-area-inset-*)` via `max()`/`calc()`, so camera cutouts, gesture-nav bars, and rounded/curved-edge screens don't clip content.
- **New "foldable / small-tablet" breakpoint (600–859px)**: previously the app jumped straight from a mobile bottom-rail (<860px) to a full 208px+ desktop sidebar (≥860px) with nothing in between. The Z Fold 5's unfolded inner display commonly lands right in that gap. Added a purpose-built compact 96px icon-forward side-rail for this range so the fold/unfold transition isn't a jarring layout jump.
- **Confirmed already-correct:** `100vh; 100dvh;` fallback on `#app` height (handles mobile browser-chrome show/hide across screen switches); no element-level fixed `min-width` rules outside their intended breakpoints (audited — all wide `width`/`min-width` hits are either inside `@media (min-width:...)` blocks or are `max-width` caps, so nothing forces horizontal overflow at 280–344px cover-screen widths); no JS-side canvas/chart width caching that would need a manual resync on resize — layout is 100% CSS grid/flex, so fold/unfold triggers a plain, correct reflow with zero JS changes needed.
- Verified: `node --check` on all extracted inline `<script>` blocks passes; CSS brace balance confirmed across all 3 inline `<style>` blocks.
- New build saved as `guidon_34.html` (4.92 MB) — now the current source of truth.

## 2026-07-13 (session 4) — Sidebar nav consolidated into collapsible groups (guidon_32.html → guidon_33.html)

**Problem:** 18 flat top-level nav items (Home, Train, Learn, Forms, Counsel, Develop, MOS, Write, Money, Health, ETS, Resources, Doctrine, Terms, Board, Risk, Progress, Author, Settings) made the sidebar visually noisy — user flagged this from a screenshot of the live app.

- Nav is now **Home + 5 collapsible labeled groups**: Board Prep (Train/Board/Doctrine/Terms), Study & Skills (Learn/Forms/Write), Leadership (Counsel/Develop/Risk), Career & Life (MOS/Money/Health/ETS/Resources), Account (Progress/Author/Settings).
- Only the group containing the active route auto-expands; others collapse to a single small-caps header with a chevron. Clicking a header toggles it open/closed.
- Pure presentation change — **no routes, hashes, or render functions were touched**; every `#/...` URL still works exactly as before. Implemented via a new `NAV_GROUPS` array + `renderNav()`/`navButton()` functions replacing the old flat `ROUTES.forEach` nav-building loop in the app-shell IIFE.
- New CSS: `.nav-group-header` (muted, uppercase, chevron-prefixed, toggles to a brighter state when open) added to both the mobile bottom-rail and desktop side-rail nav rules.
- Verified: `node --check` on all extracted inline `<script>` blocks passes.
- New build saved as `guidon_33.html` (4.92 MB) — now the current source of truth.
- Known cosmetic note: a few pre-existing `nav button:nth-child(N)` CSS rules (opacity tweaks for old group boundaries) now target different DOM positions since the nav structure changed — low-risk, purely cosmetic, worth a look next session but did not block this change.

## 2026-07-13 (session 3) — MOS Career Center added (guidon_31.html → guidon_32.html)

**New section: MOS Career Center (`#/career`, nav label "MOS").** Built from a user-supplied MOS/reclassification research document ("Full Enlisted MOS List & Reclassification Reference (2026)"). Added as a new top-level section per the user's own scope guidance ("create a new section... if it changes the scope of this program").

- Added a `career` key to `window.GUIDON_SEED`, threaded through `state.seed.career` / `store.career()`, with a `data/career.json` fallback path added for the multi-file build too.
- **163 MOS entries across 27 CMFs**: code, title, CMF, ASVAB line score, OPAT physical-demand category, notes, and FY26 status (normal/shortage/overstrength/application).
- **Army-wide reclassification policy panel** (always shown, not MOS-specific): three-gate rule, governing regs, application/board MOS list, involuntary/MAR2 reclass, ARNG/USAR differences, systems/POCs, timing guidance.
- **FY26 shortage/growth snapshot** with an SRB/Quality-Tier explainer — flagged in-app as perishable (superseded roughly every 6 months by MILPER message).
- **NCOES/promotion ladder** (grade-based E1→E9, PME gates) — separate from the existing Points Calculator, cross-references it.
- **26 warrant officer feeder-pathway entries** mapping enlisted MOSs to WO tracks.
- **Civilian certification / transferable-skill suggestions by CMF** (illustrative, not authoritative — points to Army COOL as the source of truth).
- New `G.career` module with MOS lookup (datalist-autocompleted against all 163 codes), profile-MOS prefill, and the always-visible reference panels.
- Onboarding "Your role" step: added a MOS datalist autocomplete (163 codes) to the existing free-text MOS input — no change to storage/behavior.
- Verified: `node --check` on all extracted inline `<script>` blocks passes; `window.GUIDON_SEED.career` round-trips through `eval()` with correct counts (163 MOS / 27 CMF); acronyms dictionary (3,592 terms) confirmed untouched.
- New build saved as `guidon_32.html` (4.92 MB, up from 4.8 MB) — now the current source of truth.
- Known follow-ups (see Masterfile §7): civilian certs are CMF-level not per-MOS; FY26 figures will drift and need periodic refresh; WO-feeder matching logic is substring-based and should be spot-checked before further extension; not yet cross-linked from the Profile view or the existing Transition module's civilian-career sub-tab.

**Note on this entry:** the original changelog (and the two prior handoff sessions' worth of granular entries) was lost when the source chat was deleted. The entry below is a **reconstruction baseline**, built by diffing what's observably present in `guidon_31.html` against the last known documented state (the 62nd EN BN "Board Prep" export and the 5-theme `guidon-theme-proposals.html` mockup, both still in project knowledge). Going forward, new entries should be added above this one and should describe actual deltas from this baseline, not re-describe it.

---

## [Reconstruction Baseline] — 2026-07-13 *(current — reconstructed from guidon_31.html)*

Rebuilt `GUIDON_MASTERFILE.md`, this `CHANGELOG.md`, and `GUIDON_STATE.json` from scratch after the prior handoff chat (and its versions of these three files) was deleted. Source of truth for this reconstruction: user-uploaded `guidon_31.html` (4.8 MB / 14,566 lines), cross-checked against Drive-hosted prior builds (`guidon_1.html` through `guidon_8.html`) and this project's existing knowledge (`guidon-theme-proposals.html`, `62EN_Board_Prep_Complete_Export.md`).

### Confirmed present in guidon_31.html (relative to the last fully-documented state, guidon_8.html / the 5-theme proposal doc)
- **Appearance system expanded from 5 to 14 themes.** Original proposal set (Night Vision, Field Manual, Topographic, Parade Rest, Blackout) is still present but now joined by: Desert Cadence, Squadron Blue, Range Red, Subdued, Slate Focus, Nautical Dusk, Sepia Study, Signal Amber, Ink Paper.
- **Motion system added**: 4 levels (minimal / standard / rich / cinematic), rich is default.
- **Typography pairing system added**: 7 pairings (command / field / humanist / classic / readable / terminal / broadsheet), command is default.
- **Accessibility controls added**: high-contrast toggle, large-targets toggle, auto-night-mode with configurable hours and a dedicated night theme, text-scale (4 steps), line-spacing (3 steps), nav density + nav label visibility toggles.
- **Acronyms & Terms dictionary added**: 3,592 terms, DoD Dictionary baseline (2021) + Army-specific overlay, audited to remove single-service non-Army entries.
- **Promotion Points calculator added** (v0.1.0): models the 800-point semi-centralized SGT/SSG system with category sub-maxes and threshold-based coaching tips. Explicitly scoped as a practice estimate, not an official calculator.
- **Holistic Health & Resilience module added**: 6 H2F/MRT domains (Physical, Nutritional, Mental, Spiritual, Sleep, Social), each with multiple skills, plus a curated crisis/support resources list.
- **Transition & ETS Readiness module added**: full SFL-TAP milestone timeline (730 days out through 90 days post-ETS), BDD claim walkthrough, DD-214 block-by-block reference, IDES/LDES explainer, federal-hiring and veteran career-path guidance, and a 30+-category resource directory.
- **DA Form 4856 PDF export added**, via an embedded `pdf-lib` build (vendored, Apache-2.0) with bundled AFM font metrics for Courier/Helvetica/Times/Symbol/ZapfDingbats — used to fill and export a real, usable counseling form.
- **Doctrine Q&A corpus substantially expanded**: 109 categories now represented (spanning ADP/AR/ATP/DA PAM/FM/TC doctrine sources, board procedures, creeds, EO, SHARP, land nav, drill & ceremony, fitness, financial readiness, and more), with each card carrying a richer schema than a plain flashcard (`acceptableAnswer` vs `boardAnswer` distinction, `concept` summary, `keyPoints[]`).
- **Persistence layer**: appearance prefs in `localStorage["guidon:appearance:v1"]`; broader app state in IndexedDB (`DB_NAME="guidon"`, `DB_VERSION=1`).

### Not confirmed / needs verification (see Masterfile §6)
- Whether the Chain-of-Command live-editor from the 62nd EN BN lineage carried forward.
- Exact corpus card count (this baseline estimates ~1,992 from ID-pattern matching, pending a clean recount against the actual deck/card array).
- Whether any Android/APK packaging still exists elsewhere (none found inside `guidon_31.html` itself, which is expected since that packaging lives outside the HTML file if it exists at all).

---

## Pre-reconstruction history (known from project knowledge, not independently re-verified this session)

These entries summarize what was documented in `62EN_Board_Prep_Complete_Export.md` (project knowledge) for the app's predecessor/earlier lineage. Treat as historical context, not confirmed-current state.

- **APK v13 / HTML v8**, package `com.rugged62en.boardprep`, versionCode 60007 — a Cordova-wrapped Android build of an earlier "62nd Engineer Battalion NCO Promotion Board Prep" app, 344 cards across 23 decks, 12 themes (at that point), SRS (spaced repetition), weighted-shuffle "Drill All" marathon mode, "Drill Leeches" (≥4-miss cards) mode, "Due Today" SRS queue, multiple-choice quiz mode with length-matched distractors, board-date countdown, live-editable Chain of Command deck, daily streak tracking.
- This predecessor was unit-specific (62nd Engineer Battalion / 36th Engineer Brigade) with unit history and a named MOI author (SFC Bracamontes). GUIDON as represented in `guidon_31.html` reads as more general-purpose (E1–E6, not unit-tagged in the same way) — **confirm with the user whether unit-specific content was generalized, removed, or still exists behind a settings toggle.**
