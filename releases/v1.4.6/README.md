# GUIDON v1.4.6 — release artifacts

**New in 1.4.6 — responsive and orientation audit across every layout, device
format, and rotation.** A 75-agent sweep across 13 viewport/orientation
configurations (both Fold states in both orientations, phones, tablets,
desktop widths up to ultrawide) plus hands-on rotation testing on the real
Tab and Fold found an architectural gap: the touch-target CSS rule for any
touchscreen (`pointer: coarse`) had quietly become a subset of the rule for
narrow phones (`max-width: 640px`) — so a tablet or an unfolded foldable in
landscape lost the accessibility floor on filter chips, tabs, and form
controls. Fixed, along with 13 individually undersized interactive controls
(including the copy button next to the crisis-line phone number), a topbar
icon-button width bug, and 3 safe-area gaps on the toast notification,
theater mode, and a top-anchored modal. Two suspected device bugs were
investigated and correctly ruled out — a Samsung OS-level taskbar on the
Fold's unfolded screen, and an unusual landscape aspect ratio that already
renders correctly.

Every distribution fork of the same build, verified before packaging.
Integrity: check any file against `SHA256SUMS.txt`
(`sha256sum -c SHA256SUMS.txt` or `CertUtil -hashfile <file> SHA256`).

| File | Platform | Install |
|---|---|---|
| `GUIDON_1.4.6_x64-setup.exe` | **Windows** (PC) | Run it. Per-user install, no admin. SmartScreen will warn because it is unsigned — *More info → Run anyway*. |
| `GUIDON_1.4.6_x64_en-US.msi` | **Windows** (managed/GPO) | For scripted or enterprise deployment; same app as the .exe. |
| `GUIDON-1.4.6-portable.exe` | **Windows** (no install) | The bare desktop binary — run from anywhere, including a USB stick. |
| `GUIDON-1.4.6-release.apk` | **Android** (sideload) | Signed release build. Copy to the device and open, or `adb install`. |
| `GUIDON-1.4.6-release.aab` | **Android** (Play Store) | Upload bundle for a Play listing. Not installable directly. |
| `GUIDON-1.4.6-standalone.html` | **Any browser / offline** | The single-file fork: open it from disk, email it, put it on a share drive. Works from `file://` with no server and no network. Also deployable to any static host as an installable PWA. |

Verified by sixteen automated suites plus hands-on testing on real Android
hardware across multiple orientations and fold states.
