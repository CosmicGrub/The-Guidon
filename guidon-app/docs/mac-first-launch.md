# Opening GUIDON on a Mac for the first time

This page is for anyone who downloaded the Mac version of GUIDON and was told
by their Mac that it can't be opened. **That message is expected.** Nothing is
wrong with your download, and you do not need to change any security settings
to get past it. The safe way through takes about a minute and is below.

The same steps are inside the app on the **Share & Install** screen, under
**Mac**, so they can be read with no signal.

## First: you may not need the download at all

On a Mac, the GUIDON web page **is** the full app. Open
<https://cosmicgrub.github.io/The-Guidon/> in Safari or any other browser and
it works — including with no signal once it has loaded. Nothing to download,
nothing to approve.

The Mac download is only for people who would rather keep GUIDON in their
Applications folder. **Not every GUIDON release includes one.** Look for a
file ending in `.dmg` on the
[releases page](https://github.com/CosmicGrub/The-Guidon/releases); if the
release you are looking at does not list one, use the web page instead.

The Mac version needs macOS 12.3 or newer. It runs on both Apple-chip and
Intel Macs.

## What your Mac will say

The first time you open the downloaded GUIDON, your Mac stops it. Depending on
your version of macOS the message says that Apple **could not check GUIDON for
harmful software**, or that **the developer cannot be verified**. The only
buttons are to close the message or to move GUIDON to the Trash.

### Why

Apple only skips this warning for app makers who pay for an Apple developer
membership and send every version to Apple to be checked before release.
GUIDON does not do that yet. Your Mac is not saying it found something bad —
it is saying nobody at Apple has looked.

(Apple's name for this check is *Gatekeeper*, if you want to read more about
it.)

## The safe way to open it

1. **Only do this with a copy you downloaded yourself** from the
   [GUIDON releases page](https://github.com/CosmicGrub/The-Guidon/releases).
   Never do it for a copy that was sent to you in a message, emailed, or passed
   around on a drive — that is exactly the situation the warning exists for.
2. Open the `.dmg` file and drag **GUIDON** into **Applications**.
3. Open GUIDON once. When the warning appears, close it. **Do not choose
   "Move to Trash".**
4. Open **System Settings**, choose **Privacy & Security**, and scroll down to
   the **Security** section.
   *On macOS 12 this is System Preferences, then Security & Privacy, then the
   General tab.*
5. Next to the note saying GUIDON was blocked, click **Open Anyway**. This
   button is only there for about an hour after step 3 — if it is missing,
   repeat step 3.
6. Your Mac asks you to confirm with your Mac password or Touch ID, then shows
   the warning one last time — this time with a button that opens GUIDON.
   Click it.

Your Mac remembers the choice. From then on GUIDON opens like any other app,
and you only have to do this again after installing a newer version.

These are Apple's own steps; Apple's version of them is here:
[Open a Mac app from an unknown developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).

## If you see something different

If the message says anything else — for example that GUIDON **is damaged** —
stop. Delete the download and use the web page instead.

**Never** turn off your Mac's security settings, and **never** paste commands
into Terminal, to get GUIDON (or any app) to open. No step in opening GUIDON
needs either, and advice that says otherwise is not from this project.

## Your study data

The Mac version and the web page keep their study data separately, each on
your Mac and nowhere else. To move from one to the other, open **Profile**,
find **Backup & restore**, choose **Export backup** in the one you are leaving
and **Import backup** in the one you are moving to.

---

*For maintainers.* The Mac build is signed only ad hoc on the build machine and
is not sent to Apple for review, because the project has no Apple Developer ID
and this repository has no Actions secrets. That is why the first open is
refused. `release-apple.yml` is ready for the day that changes: when the owner
adds the six Apple secrets - `APPLE_CERTIFICATE_BASE64`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` - it signs with the Developer
ID, notarizes, staples and verifies the result. With none of them set it builds
the ad-hoc `.dmg` as before, green, and says in the run that Mac users will see
this warning; with only some of them set it fails at once. What each secret is
and how to add it: `docs/release-runbook.md`, "macOS signing and notarization".

The Mac build is also attached to a release under a never-changing name,
`GUIDON-macos-universal.dmg`, next to the versioned one. That name is optional
for a release, so the Share & Install button stays on the releases list until
the owner switches the direct download on (same runbook, "Mac: the fixed-name
file"). This page says "not every release includes one" for that reason.

The day the first notarized `.dmg` ships, the steps above stop being necessary
and this page and the **Mac** panel on Share & Install (`src/index.html`, the
share view) should be rewritten together. `tools/test-share-mac-first-open.mjs`
holds the two in step.
