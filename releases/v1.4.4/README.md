# GUIDON v1.4.4 — release artifacts

**New in 1.4.4 — a 49-agent parallel audit finds nine real contrast bugs.**
A broader automated sweep (every route at the Fold's 344px width, plus a
legibility pass across routes never touched by the contrast suite before —
Search, Settings, Records, Calendar, Profile, Doctrine, Currency, Leader)
found the Search view's category filter chips and a section heading using
raw accent colors as text, failing contrast on light themes. Fixing it
surfaced a deeper bug: the active chip's background was hardcoded to a
literal orange, which broke in the `squadron-blue` theme (text and
background nearly identical, 1.01:1) since that theme reassigns "amber" to
blue for its branding — now derived from the actual token in every theme.
Also fixed: a bug in the audit tooling itself that would have reported a
false failure, two weakened test assertions tightened, an onboarding
top-safe-area gap, and a topbar subtitle that dropped content with no
warning below ~375px width (now wraps instead).

Every distribution fork of the same build, verified before packaging.
Integrity: check any file against `SHA256SUMS.txt`
(`sha256sum -c SHA256SUMS.txt` or `CertUtil -hashfile <file> SHA256`).

| File | Platform | Install |
|---|---|---|
| `GUIDON_1.4.4_x64-setup.exe` | **Windows** (PC) | Run it. Per-user install, no admin. SmartScreen will warn because it is unsigned — *More info → Run anyway*. |
| `GUIDON_1.4.4_x64_en-US.msi` | **Windows** (managed/GPO) | For scripted or enterprise deployment; same app as the .exe. |
| `GUIDON-1.4.4-portable.exe` | **Windows** (no install) | The bare desktop binary — run from anywhere, including a USB stick. |
| `GUIDON-1.4.4-release.apk` | **Android** (sideload) | Signed release build. Copy to the device and open, or `adb install`. |
| `GUIDON-1.4.4-release.aab` | **Android** (Play Store) | Upload bundle for a Play listing. Not installable directly. |
| `GUIDON-1.4.4-standalone.html` | **Any browser / offline** | The single-file fork: open it from disk, email it, put it on a share drive. Works from `file://` with no server and no network. Also deployable to any static host as an installable PWA. |

Verified by sixteen automated suites plus new Search/Settings contrast
coverage (24 themes each), and a hands-on audit on real Android hardware
(Tab S9 FE, Galaxy Z Fold 5).
