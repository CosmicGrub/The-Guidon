# GUIDON v1.4.2 — release artifacts

**New in 1.4.2 — a hands-on device audit fixes a real narrow-phone bug.**
Running the app on the actual hardware (Tab S9 FE, Galaxy Z Fold 5 folded to
its 344px cover screen) found the topbar wordmark truncating to "GUI…" on the
narrowest real viewport this app renders on — the fixed-width "Online" status
chip left too little room for the brand name. Fixed by hiding that chip below
480px, the same threshold already used to hide the profile name badge on
phones. Verified with a new suite across five widths, including the exact
Fold measurement. (A second suspected bug — a Board Prep tab strip that looked
hard-clipped — turned out on closer inspection to be a working fade affordance
from an earlier session; no change was needed there.)

Every distribution fork of the same build, verified before packaging.
Integrity: check any file against `SHA256SUMS.txt`
(`sha256sum -c SHA256SUMS.txt` or `CertUtil -hashfile <file> SHA256`).

| File | Platform | Install |
|---|---|---|
| `GUIDON_1.4.2_x64-setup.exe` | **Windows** (PC) | Run it. Per-user install, no admin. SmartScreen will warn because it is unsigned — *More info → Run anyway*. |
| `GUIDON_1.4.2_x64_en-US.msi` | **Windows** (managed/GPO) | For scripted or enterprise deployment; same app as the .exe. |
| `GUIDON-1.4.2-portable.exe` | **Windows** (no install) | The bare desktop binary — run from anywhere, including a USB stick. |
| `GUIDON-1.4.2-release.apk` | **Android** (sideload) | Signed release build. Copy to the device and open, or `adb install`. |
| `GUIDON-1.4.2-release.aab` | **Android** (Play Store) | Upload bundle for a Play listing. Not installable directly. |
| `GUIDON-1.4.2-standalone.html` | **Any browser / offline** | The single-file fork: open it from disk, email it, put it on a share drive. Works from `file://` with no server and no network. Also deployable to any static host as an installable PWA. |

Verified by sixteen automated suites (179 assertions) — build, promotion-point
tables vs the regulation, corpus consistency, accessibility tree, theme
contrast, narrow-viewport topbar integrity, SRS bridge, theater mode, flip
animation, DA 4856 PDF, standalone `file://`, desktop CSP, and more — plus
NVDA screen-reader walks of the core flows and a hands-on audit on real
Android hardware.
