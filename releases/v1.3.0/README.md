# GUIDON v1.3.0 — release artifacts

**New in 1.3.0: fullscreen study.** The ⤢ button on any Board Drill card takes
it fullscreen — the card and its study controls only, everything else covered.
Escape, the button, Android Back, or navigating away exits. On Android the
status bar hides too.

Every distribution fork of the same build, verified before packaging.
Integrity: check any file against `SHA256SUMS.txt`
(`sha256sum -c SHA256SUMS.txt` or `CertUtil -hashfile <file> SHA256`).

| File | Platform | Install |
|---|---|---|
| `GUIDON_1.3.0_x64-setup.exe` | **Windows** (PC) | Run it. Per-user install, no admin. SmartScreen will warn because it is unsigned — *More info → Run anyway*. |
| `GUIDON_1.3.0_x64_en-US.msi` | **Windows** (managed/GPO) | For scripted or enterprise deployment; same app as the .exe. |
| `GUIDON-1.3.0-release.apk` | **Android** (sideload) | Signed release build. Copy to the device and open, or `adb install`. |
| `GUIDON-1.3.0-release.aab` | **Android** (Play Store) | Upload bundle for a Play listing. Not installable directly. |
| `GUIDON-1.3.0-debug.apk` | **Android** (development) | Debuggable build with WebView inspection enabled. Larger and slower — not for daily use. |
| `GUIDON-1.3.0-standalone.html` | **Any browser / offline** | The single-file fork: open it from disk, email it, put it on a share drive. Works from `file://` with no server and no network. Also deployable to any static host as an installable PWA. |

iOS/macOS is deliberately on the backburner (owner's call). The web fork
covers Apple devices today via Safari → Add to Home Screen.

All six artifacts come from one `src/index.html`; see `guidon-app/README.md`
for how the build fans out.
