# AGP 8.13.0 → 9.3.0 migration plan (task #247)

**Status: plan only — not executed.** Written 2026-08-13 against the real state of
this project's `android/` tree, not generic upstream advice. Do not attempt this
bump until the "Recommendation" section's blockers are cleared.

## Current state (verified against this repo)

| | Current | AGP 9.0 minimum |
|---|---|---|
| AGP | `8.13.0` (`android/build.gradle`) | `9.0.0`+ (task targets `9.3.0`) |
| Gradle | `8.14.3` (`android/gradle/wrapper/gradle-wrapper.properties`) | `9.1.0` |
| JDK | 17 installed in this environment | 17 (met) |
| SDK Build Tools | not pinned explicitly (uses whatever `compileSdk 36` resolves) | `36.0.0`+ |
| `compileSdk`/`targetSdk`/`minSdk` | 36 / 36 / 24 (`android/variables.gradle`) | supported |
| Kotlin | **none** — `app/src` is pure Java (`MainActivity.java`), no `.kt` files, no Kotlin Gradle plugin anywhere in `android/**/*.gradle` | N/A |
| `@capacitor/android`/`cli`/`core` | `8.5.0` (bumped this pass, task #242) | unconfirmed — see Blocker 3 below |
| Native plugins | `@capacitor/app` 8.1.1, `filesystem` 8.1.2, `local-notifications` 8.2.1, `share` 8.0.1, `status-bar` 8.0.3 | unconfirmed |
| `com.google.gms:google-services` | `4.5.0` (bumped this pass, task #243) | unconfirmed |

**No Kotlin at all is the single biggest simplification here.** AGP 9.0's headline
breaking-change category — built-in Kotlin support replacing the
`org.jetbrains.kotlin.android` plugin, KGP 2.2.10 becoming a runtime dependency,
Kotlin Multiplatform's plugin-isolation rule — is entirely inapplicable. This
project has zero Kotlin surface to migrate.

## What I checked directly (not assumed)

- `grep`'d every `*.gradle` file under `android/` for the specific DSL patterns
  AGP 9.0 removes outright: `applicationVariants`, `libraryVariants`,
  `variantFilter`, `dexOptions`, `generatePureSplits`, `registerArtifactType`,
  density `splits {}`. **Zero matches.** This project's own hand-written Gradle
  files (`android/build.gradle`, `android/app/build.gradle`,
  `android/variables.gradle`) don't touch any AGP-9-removed API.
- Confirmed `android/app/build.gradle` builds signing/proguard config as
  `proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'`
  with `minifyEnabled false` (R8 never actually runs today, by deliberate
  choice — see that file's own comment on why). AGP 9.0 makes
  `android.r8.proguardAndroidTxt.disallowed` default to `true`, which rejects
  `proguard-android.txt` outright. Since minify is off this may not fail the
  build, but it's an easy, low-risk pre-migration fix either way — see
  "Pre-work" below.
- Confirmed `android/build.gradle`'s `repositories { flatDir { ... } }` usage
  (both top-level and in `app/build.gradle`) already prints
  `WARNING: Using flatDir should be avoided because it doesn't support any
  meta-data formats.` under the CURRENT Gradle 8.14.3 (seen live in this
  session's own `assembleDebug` output). Gradle 8→9 is itself a major-version
  jump with its own deprecation-to-error escalations independent of AGP; a
  long-standing warning like this is a real candidate for becoming a hard
  error under Gradle 9.1.0 and should be checked, not assumed fine.
- Confirmed (this session, live) that a real `assembleDebug` in this exact
  environment currently fails — **not from anything AGP-9-related** — because
  `@capacitor/filesystem`'s own `android/build.gradle` hardcodes
  `sourceCompatibility JavaVersion.VERSION_21` / `targetCompatibility
  JavaVersion.VERSION_21`, and this environment only has JDK 17 installed
  (`Cannot find a Java installation... matching: {languageVersion=21...}`).
  This is orthogonal to the AGP version (AGP 9.0 itself only requires JDK 17)
  but it means **this environment cannot currently produce ANY real Gradle
  build output to verify an AGP bump against**, AGP 8 or 9. See Blocker 1.

## Blockers (must clear before attempting the bump, in this order)

1. **JDK 21 is not installed in this dev environment.** Independent of AGP
   version, `@capacitor/filesystem` already requires it. Without it, neither
   the current AGP 8.13.0 setup nor a future AGP 9.x setup can be
   build-verified here — the migration would be flying blind. Install a JDK
   21 toolchain (or point Gradle's toolchain resolution at one) before doing
   anything else in this list.
2. **Capacitor/Cordova ecosystem AGP 9 support is unconfirmed for the
   versions this project actually pins.** AGP 9.0 requires Gradle 9.1.0+,
   and third-party Android library projects (Capacitor's own
   `capacitor-android`, the 5 native plugins, and
   `capacitor-cordova-android-plugins`) must each build cleanly under AGP 9's
   new DSL and R8 defaults — that's out of this project's control. Before
   bumping, check each plugin's own changelog/issue tracker for an explicit
   "AGP 9 compatible" note, the same way this session confirmed each routine
   npm bump's real behavior rather than assuming semver good faith.
3. **`com.google.gms:google-services` AGP-9 compatibility is unconfirmed.**
   Decoupled release cadence from AGP; verify at migration time rather than
   assuming today's `4.5.0` (bumped this pass) is still current or compatible
   by then.
4. **Gradle 8.14.3 → 9.1.0+ is its own major upgrade**, not folded into "the
   AGP bump." Budget a separate verification pass for Gradle 9's own breaking
   changes (the `flatDir` warning above is one concrete thing to watch), not
   just AGP 9's.

## Pre-work (safe to do independent of the AGP bump itself, low risk)

- Swap `getDefaultProguardFile('proguard-android.txt')` →
  `getDefaultProguardFile('proguard-android-optimize.txt')` in
  `android/app/build.gradle`. Matches the officially documented AGP 9 fix,
  costs nothing today (minify is off), and removes one item from the eventual
  migration diff.
- Once JDK 21 is available (Blocker 1), re-run `assembleDebug` under the
  CURRENT AGP 8.13.0 first, to get a clean baseline build in this environment
  before introducing the AGP 9 variable. Right now this repo has never had a
  fully-verified real Gradle build in this specific dev environment (only
  `npx cap sync android`, which doesn't invoke Gradle/AGP at all) — that gap
  should close before, not during, a major-version migration.

## Migration checklist, once blockers are clear

1. Confirm Capacitor's official AGP 9 support statement for the
   `@capacitor/*` versions in use at that time (re-pin to whatever's current;
   don't assume this session's `8.5.0` is still the target).
2. Bump `android/gradle/wrapper/gradle-wrapper.properties` to Gradle `9.1.0`+
   first, verify a clean `assembleDebug` on AGP 8.13.0 + Gradle 9 before
   touching AGP itself (isolates which of the two upgrades caused any given
   failure).
3. Bump `android/build.gradle`'s `com.android.tools.build:gradle` classpath
   to `9.3.0`.
4. Address the AGP-9-flagged `gradle.properties` defaults from the official
   upgrade guide that actually apply here — most of the long "properties now
   default to `true`" list (`android.newDsl`, `android.uniquePackageNames`,
   `android.useAndroidx` — already `true` in this project's own
   `gradle.properties`, `android.enableAppCompileTimeRClass`,
   `android.r8.strictFullModeForKeepRules`, etc.) is either already-satisfied
   or low-risk for a minifyEnabled-false, no-Kotlin, single-module app like
   this one — confirm each against a real build rather than assuming.
5. Run the project's own native-build verification path
   (`tools/verify-release-apk.mjs`, per task #32) against the AGP-9 build
   output before calling this done.
6. Full JS-side battery too (`npm run lint:patterns && npm run build && npm
   run verify`, then the batched `run-parallel.mjs` suites per this
   project's documented Windows `npm test` workaround) — an AGP bump
   shouldn't touch `web/`/`dist/` at all, but confirming that stays true is
   cheap insurance.

## Recommendation

**Defer.** The web-app side of this bump (task #247 asks only for a written
plan) is low-risk — this project's own Gradle files use none of AGP 9's
removed APIs, and there's no Kotlin to migrate. The real gating factors are
entirely outside this repo's control (Blockers 1–4 above), and this specific
dev environment cannot even produce a verified baseline Gradle build today
(Blocker 1) to migrate FROM, let alone TO. Revisit once JDK 21 is available
here and the Capacitor ecosystem has published explicit AGP 9 compatibility
for the plugin versions this project depends on at that time.
