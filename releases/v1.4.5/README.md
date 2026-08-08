# GUIDON v1.4.5 — release artifacts

**New in 1.4.5 — the deferred contrast sweep, finished by hand after the
audit ran out of budget.** A follow-on sweep of 186 more raw-accent-as-text
candidates hit the account's weekly agent quota mid-verification (106 of 110
verify calls failed outright). Rather than trust the unverified findings,
they were recovered from the workflow's own log and re-checked by hand with
a fresh 24-theme Playwright sweep — which caught three real bugs in the
*verification tooling itself* before any of it could produce a wrong code
fix (a background-compositing walk that mishandled translucent layers,
solid-color resolution, and decorative low-opacity gradient glows in three
different ways). Once the measurement was trustworthy, it confirmed 18 real
contrast bugs — the same pattern as v1.4.4's nine — and all 18 are fixed and
re-verified clean across every theme.

Every distribution fork of the same build, verified before packaging.
Integrity: check any file against `SHA256SUMS.txt`
(`sha256sum -c SHA256SUMS.txt` or `CertUtil -hashfile <file> SHA256`).

| File | Platform | Install |
|---|---|---|
| `GUIDON_1.4.5_x64-setup.exe` | **Windows** (PC) | Run it. Per-user install, no admin. SmartScreen will warn because it is unsigned — *More info → Run anyway*. |
| `GUIDON_1.4.5_x64_en-US.msi` | **Windows** (managed/GPO) | For scripted or enterprise deployment; same app as the .exe. |
| `GUIDON-1.4.5-portable.exe` | **Windows** (no install) | The bare desktop binary — run from anywhere, including a USB stick. |
| `GUIDON-1.4.5-release.apk` | **Android** (sideload) | Signed release build. Copy to the device and open, or `adb install`. |
| `GUIDON-1.4.5-release.aab` | **Android** (Play Store) | Upload bundle for a Play listing. Not installable directly. |
| `GUIDON-1.4.5-standalone.html` | **Any browser / offline** | The single-file fork: open it from disk, email it, put it on a share drive. Works from `file://` with no server and no network. Also deployable to any static host as an installable PWA. |

Verified by sixteen automated suites, including a corrected `test-contrast.mjs`
whose own background-compositing logic was debugged in the same pass.
