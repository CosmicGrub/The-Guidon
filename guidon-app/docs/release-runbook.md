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
whether a release is Latest.

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

## Where things stand (2026-09-19)

- Tagged: v1.9.0 (complete), v1.10.0 (two Windows files only - it was cut from
  a commit CI never ran on, has no in-app What's New entry and no CHANGELOG
  entry), v1.10.1.
- 1.11.0 and 1.12.0 were version-bumped on main but never cut. The hosted web
  app did run builds calling themselves 1.11.0 and 1.12.0. Do **not** tag
  either number now: a corrected build under an already-used number would put
  two different "1.12.0"s in the wild. Ship the corrected work as the next
  patch number and record 1.11.0 / 1.12.0 in the CHANGELOG as
  "prepared, not released".
- While v1.10.0 is Latest, both in-app download buttons are dead links.
  Reversible stop-gap (changes public release state, so it is the owner's
  call): `gh release edit v1.9.0 --latest`, which carries both version-less
  files. The next complete release takes Latest back automatically.
