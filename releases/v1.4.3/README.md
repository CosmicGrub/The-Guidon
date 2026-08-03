# GUIDON v1.4.3 — release artifacts

**New in 1.4.3 — the onboarding screen clears the system nav bar.**
The same hands-on device audit that found v1.4.2's topbar bug also caught a
softer issue on the very first screen a new user sees: on the Fold's cover
screen, the third onboarding card ("Kiosk / Demo Mode") had its description
text sitting partly behind the translucent system navigation bar. Everything
was still reachable by scrolling — nothing was actually broken — but there
was no cue that scrolling would help, and a card ending mid-sentence behind
a system bar looks wrong on first glance. Fixed the same way `.main` and the
nav rail already handle this: bottom padding now adds `env(safe-area-inset-bottom)`
instead of a fixed pixel value.

Every distribution fork of the same build, verified before packaging.
Integrity: check any file against `SHA256SUMS.txt`
(`sha256sum -c SHA256SUMS.txt` or `CertUtil -hashfile <file> SHA256`).

| File | Platform | Install |
|---|---|---|
| `GUIDON_1.4.3_x64-setup.exe` | **Windows** (PC) | Run it. Per-user install, no admin. SmartScreen will warn because it is unsigned — *More info → Run anyway*. |
| `GUIDON_1.4.3_x64_en-US.msi` | **Windows** (managed/GPO) | For scripted or enterprise deployment; same app as the .exe. |
| `GUIDON-1.4.3-portable.exe` | **Windows** (no install) | The bare desktop binary — run from anywhere, including a USB stick. |
| `GUIDON-1.4.3-release.apk` | **Android** (sideload) | Signed release build. Copy to the device and open, or `adb install`. |
| `GUIDON-1.4.3-release.aab` | **Android** (Play Store) | Upload bundle for a Play listing. Not installable directly. |
| `GUIDON-1.4.3-standalone.html` | **Any browser / offline** | The single-file fork: open it from disk, email it, put it on a share drive. Works from `file://` with no server and no network. Also deployable to any static host as an installable PWA. |

Verified by sixteen automated suites (179 assertions) plus a hands-on audit
on real Android hardware (Tab S9 FE, Galaxy Z Fold 5 folded to its 344px
cover screen).
