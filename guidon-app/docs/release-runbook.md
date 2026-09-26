# GUIDON release runbook

How a GUIDON release is cut, what the automation does on its own, and the one
part that always happens on the owner's machine (Android signing). Written
2026-09-19 after an audit of the v1.10.0 - v1.12.0 stretch; the "why" behind
each rule is in the header comment of the workflow that enforces it.

## The short version

| Step | Who | What happens |
|---|---|---|
| 1. Get main green | anyone | Every change lands through a PR whose **CI green** check passed. |
| 2. Bump the version | anyone | `node tools/bump-version.mjs <x.y.z> --write` (one command, every file), plus the What's New and CHANGELOG entries. `npm run lint:patterns` proves the files agree. |
| 2a. Legal package | anyone | After `npm run build`, run `node tools/verify-legal-package.mjs --run --write-stamp` (from `guidon-app/`): it runs every test the Command/Legal package's claims name and, only if all pass, stamps `GUIDON_COMMAND_LEGAL_PACKAGE.md` with this version and commit; commit the stamp with the bump. `npm run lint:patterns` already checks the package cannot drift; `node tools/verify-legal-package.mjs --release` fails if the stamp is not for the version being cut. |
| 3. Cut | owner | Commit `guidon-app/src/.release-prep` containing `vX.Y.Z` to main. `release-cut.yml` waits for CI on that exact commit and only then creates the tag and an empty, **not-Latest** release. |
| 4. Fan out | owner | Commit `guidon-app/src/.release-trigger` containing `vX.Y.Z`. `release-assets.yml` and `release-apple.yml` build from the tag and attach files. |
| 5. Android | owner, locally | Build, sign and attach the three Android files (below), then run **Release assets** by hand with **finalize_only** ticked. |
| 6. Latest | automation | The finalize job rewrites the Downloads section from what is really attached and marks the release Latest only when it is complete. |
| 7. Devices | owner, present | Push the build to the owner's own devices (standing distribution rule). Never done unattended. |

Until step 6 succeeds the previous release stays Latest, so the download
buttons inside the app (`#/share`) keep working the whole time.

## What "complete" means

`tools/release-manifest.mjs` is the one list. A release is complete when it
carries all of these (X.Y.Z = the version):

- `GUIDON-android.apk` and `GUIDON-windows-setup.exe` - the two **version-less**
  names the in-app download buttons ask for
  (`.../releases/latest/download/<name>`). Leave either out and that button is
  a dead link for every new user. `npm run lint:patterns`
  (`tools/lint-release-state.mjs`) fails if the app ever links a name that no
  release job uploads.
- `GUIDON-X.Y.Z-android.apk`, `GUIDON-X.Y.Z-android.aab`
- `GUIDON-X.Y.Z-windows-setup.exe`, `GUIDON-X.Y.Z-windows.msi`
- `GUIDON-X.Y.Z-web-pwa.zip`, `GUIDON-X.Y.Z-standalone.html`
- the five `GUIDON-X.Y.Z-esp32-*` files

The Mac `.dmg` and the iOS Simulator package are attached when the Apple lane
produces them, and are listed on the release page only then. They never decide
whether a release is Latest. The Apple lane also attaches the same `.dmg` a
second time as `GUIDON-macos-universal.dmg`, a fixed name like the two above
but **optional** - see "Mac: the fixed-name file, the launch proof, and Apple
signing" below for why it is not required and what that means for the in-app
Mac button.

## Android: signed on the owner's machine, attached by hand

This repository has **no Actions secrets, on purpose**. The Android signing key
lives only on the owner's machine. Nobody else - a contributor, an assistant, a
workflow - creates, copies, uploads or prints it. With no secrets configured,
the Android job in `release-assets.yml` ends green in a few seconds with a
notice that says exactly which files it is waiting for; it does not fail the
run. (If the owner ever chooses to add the four `ANDROID_*` secrets, the same
job builds and signs in CI with no workflow change. Half-configured secrets are
a hard failure.)

The hand-off, after step 4 above:

1. Build from the **tag**, not from whatever main is now, in a throwaway
   worktree on the same drive as `node_modules`:
   `git worktree add --detach <short path> vX.Y.Z`
2. Put the key material in place the way the local build expects
   (`guidon-app/keys/guidon-release.jks` and `guidon-app/android/keystore.properties`;
   both are git-ignored). Never paste their contents anywhere.
3. `npm run android:release`
4. Prove the signer is the same one every earlier GUIDON build used - a
   different key means Android refuses to update an installed copy:
   - `apksigner verify --print-certs app-release.apk` - the SHA-256 must be
     `83a0cae688a714aa008022d9ab8be5840d327c7b0f6e673e426fe113ed1e1da2`
     (the value `release-assets.yml` pins; background in
     `docs/android-signing-continuity.md`)
   - `keytool -printcert -jarfile app-release.aab` - same certificate
   - `aapt2 dump badging app-release.apk` - `versionName` is X.Y.Z and
     `versionCode` is the number in `android/app/build.gradle`

   `npm run android:verify-release` is **not** this check: it compares an
   attached device's installed copy with the local web build.
5. Attach the three files (the third is the same `.apk` under the name the
   in-app button uses):

   ```
   cp app-release.apk GUIDON-X.Y.Z-android.apk
   cp app-release.apk GUIDON-android.apk
   cp app-release.aab GUIDON-X.Y.Z-android.aab
   gh release upload vX.Y.Z GUIDON-X.Y.Z-android.apk GUIDON-X.Y.Z-android.aab GUIDON-android.apk --clobber
   ```
6. Delete the copied key material from the throwaway worktree, then remove the
   worktree.
7. GitHub -> Actions -> **Release assets** -> Run workflow -> tick
   **finalize_only** (leave the tag empty to use main's version, or name the
   tag). Nothing is rebuilt; the job refreshes the Downloads section and marks
   the release Latest once everything is attached and really downloads.

## Mac: the fixed-name file, the launch proof, and Apple signing

Written 2026-09-25 (audit item 17 and roadmap item L). This describes the
`macos` job in `release-apple.yml`. **None of it can decide whether a release
is Latest**: `tools/lint-release-state.mjs` check (f) fails the build if
`release-apple.yml` ever touches the Latest flag, or if any other release job
starts waiting on an Apple job. It was also written without a macOS runner or
Apple credentials to try it on. The scripts are exercised against stand-in
tools by `tools/test-release-pipeline.mjs`; the first real run is the real test.

### The fixed-name file, and why the in-app Mac button is not a direct link (yet)

The Apple lane uploads the same `.dmg` twice, in one command:
`GUIDON-X.Y.Z-macos-universal.dmg` and `GUIDON-macos-universal.dmg` (a copy of
the same bytes) - the way the Android and Windows jobs do it.

The decision, and what it costs:

- The Android and Windows fixed names are **required**: a release without them
  is never Latest, so `.../releases/latest/download/<name>` always resolves.
- A **required** Mac name would let the Apple lane - a separate workflow on
  hosted Macs that fail now and then - hold a release out of Latest. That is
  ruled out, so `GUIDON-macos-universal.dmg` is **optional** in
  `tools/release-manifest.mjs` (`OPTIONAL_ALIASES`).
- GitHub's `latest/download` link has **no fallback**. If the Latest release
  has no such file, the link is a 404. The app cannot check first: it makes no
  network requests, and that must stay true.
- So the #/share Mac button stays on the releases list - the one link that can
  never be dead - until the owner deliberately switches the direct link on:
  `const MAC_DIRECT_LINK = false;` in `src/index.html`. The code, the lint
  and the tests for the direct button are in place and proven in both
  settings; only the switch is off.
- Carrying an older release's Mac file forward under the new release, so the
  name always resolves, was considered and rejected: a Mac copy that is silently
  a version behind is worse than a visible "not there yet", because the web
  page is always current.

**Turning on the direct Mac download** (owner, once the Apple lane has proved
itself on a real run):

1. Wait for a release that is **Latest** and whose Apple run finished green.
2. `node tools/lint-release-state.mjs --published vX.Y.Z --repo CosmicGrub/The-Guidon`
   must say that release carries `GUIDON-macos-universal.dmg`.
3. On that run, open "Prove the DMG launches" in the summary - it should say
   *passed* - and then download `GUIDON-macos-universal.dmg` from the release
   and open it on a real Mac once.
4. Change `const MAC_DIRECT_LINK = false;` to `true` in `src/index.html`, then
   run `node tools/test-share-mac-first-open.mjs` and
   `node tools/lint-release-state.mjs` (it prints a note that the direct link
   is on).
5. From then on, a release whose Apple lane fails leaves the Mac button dead
   until **Apple release assets** is run again. The run says so in a warning
   ("The fixed-name Mac file is missing"), and `--published` reports it. If
   that keeps happening, set the switch back to `false`.

### The launch proof

After the bundle checks, the job mounts the built `.dmg`, copies the app out,
opens it as a person would, and requires the app to stay running for 20 seconds
with no crash report. It reports one of four results in the run summary, as a
notice or warning, and in `macos-launch-proof.txt` in the verification record:

| Result | Meaning |
|---|---|
| passed | The app started and stayed up. |
| failed | It started and quit on its own, macOS wrote a crash report, macOS refused to open it, or the image had no app in it. |
| never-started | No GUIDON process appeared within 30 seconds. |
| inconclusive | The proof itself could not run (the image would not mount, the copy failed). Says nothing about the app. |

It is **informational**: the step never fails the job, and the `.dmg` is
published whatever it says. Once a few real runs show it is trustworthy on a
hosted Mac, make "Publish macOS DMG" depend on it. Do not switch the direct Mac
download on after any result but *passed*.

### macOS signing and notarization (owner adds the secrets; nobody else does)

This repository has **no Actions secrets, on purpose**, and a workflow or an
assistant must never be what creates them. The `macos` job follows the same
three outcomes as the Android job:

| Secrets | What the job does |
|---|---|
| none of the six | Builds the ad-hoc-signed `.dmg` it always has and ends **green**, with a notice saying what is missing and that Mac users get the first-open warning (`docs/mac-first-launch.md`). This is the normal state. |
| all six | Signs with the Developer ID certificate, notarizes the app and the `.dmg` with Apple, staples both tickets, and checks the result with `codesign`, `spctl` and `stapler`. Any failure turns this workflow red; the release's Latest status is untouched. |
| some, not all | **Hard failure** naming what is missing, before anything is built. |

The check only tests that each secret exists; it never prints or writes a
value. The six (each also accepted with a `GUIDON_` prefix, like the Android
ones):

| Secret | What it holds |
|---|---|
| `APPLE_CERTIFICATE_BASE64` | The **Developer ID Application** certificate with its private key, exported from Keychain Access as a `.p12` and base64-encoded (`base64 -i DeveloperID.p12 \| pbcopy` on a Mac). Needs a paid Apple Developer Program membership. |
| `APPLE_CERTIFICATE_PASSWORD` | The password chosen when the `.p12` was exported. |
| `APPLE_SIGNING_IDENTITY` | The certificate's full name, exactly as `security find-identity -v -p codesigning` prints it, for example `Developer ID Application: Your Name (TEAMID)`. |
| `APPLE_ID` | The Apple ID (email) that belongs to the developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password made for that Apple ID at appleid.apple.com (Sign-In and Security). **Not** the Apple ID password. |
| `APPLE_TEAM_ID` | The ten-character Team ID shown under Membership details in the Apple Developer account. |

Add them in GitHub under Settings, Secrets and variables, Actions, "New
repository secret" (or `gh secret set NAME`), then run **Apple release assets**
by hand. Never paste a value into a chat, an issue, a commit or a log.

**When it starts working**, the first-open warning goes away for the people who
download the notarized `.dmg`, and `docs/mac-first-launch.md` and the **Mac**
panel on #/share (`src/index.html`) stop being true as written. Rewrite the two
together, and `tools/test-share-mac-first-open.mjs` in the same change - it is
what holds them in step.

## Rules the automation now enforces

- **No tag without green CI.** `release-cut.yml` runs only on main, checks that
  every version-bearing file agrees (`tools/lint-release-state.mjs --cut`),
  then waits for CI on that exact commit (`tools/release-gate.mjs`; Desktop
  and iOS too when they ran). Red, missing, or unreadable all refuse. A version
  tag is permanent - never move or delete one. If a tagged release is bad, ship
  the next patch number.
- **No installers from an unverified tag.** Both asset workflows ask the same
  gate about the tag's commit before building anything.
- **No deploy without green CI.** `pages.yml` runs when CI completes, only for
  a successful push run on main, checks out the commit CI tested, and never
  redeploys an older commit over a newer live one.
- **One verdict per CI run.** The `CI green` job fails unless lint + build +
  verify, cargo check and the whole test matrix succeeded; a skipped matrix
  counts as not green.
- **No orphan test suites.** `tools/lint-ci-matrix.mjs` fails if a
  `tools/test-*.mjs` file is run by nothing.

## Settings only the owner can change (recommended, not yet done)

These are repository settings, not files, so no PR can make them:

1. Branch rule on `main`: require the **CI green** status check before merging.
   (The existing "Protect" ruleset targets no branches; give it
   `~DEFAULT_BRANCH`.) Three of the four PRs before this runbook were merged
   red; the workflows now refuse to tag or deploy a red commit, but only this
   setting stops the merge itself.
2. Tag rule on `refs/tags/v*`: block update and deletion, so "a version tag is
   permanent" is enforced by GitHub rather than by habit.

## Where things stand (2026-09-19, after v1.12.1)

- **v1.12.1 is Latest and complete**: every platform file plus both fixed-name
  download files. It was the first release cut end to end through this
  runbook. Two things learned doing it:
  - Run `node guidon-app/tools/lint-release-state.mjs --cut` locally with
    `.release-prep` in place BEFORE merging the cut. It reads the CHANGELOG
    heading and the first line under it; an opening paragraph that mentions
    *other* versions as "never released" reads as this version marking itself
    unreleased. Open the entry with a plain "Released <date> ..." line.
  - Step 4 needs no commit. Once the tag exists, run **Release assets** by hand
    with the tag filled in (and **Release Apple** from main). Attach the locally
    signed Android files first and the same run finishes the release and marks
    it Latest, so a separate `finalize_only` run is only needed when the Android
    files arrive later. The Android build can start from the cut commit while
    the cut is still waiting on CI: the tag will point at exactly that commit.
- Earlier tags: v1.9.0 (complete); v1.10.0 (cut from a commit CI never ran on,
  Windows files only - Android and both fixed-name files attached on
  2026-09-18, CHANGELOG entry written retroactively); v1.10.1 (published
  retroactively on 2026-09-18 from its original commit, every platform
  attached).
- 1.11.0 and 1.12.0 were version-bumped on main but never cut, and never will
  be: builds calling themselves 1.11.0 and 1.12.0 ran on the hosted web app, and
  a corrected build under an already-used number would put two different
  "1.12.0"s in the wild. v1.12.1 supersedes both; the CHANGELOG records them as
  "prepared, not released" and their What's New entries stay `released: false`.
- Full record of why: `GUIDON files/AUDIT-2026-09.md`.
