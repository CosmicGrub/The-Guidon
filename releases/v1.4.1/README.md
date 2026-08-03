# GUIDON v1.4.1 — release artifacts

**New in 1.4.x — the icon system, legibility proven, and the SRS bridge.**

- **1.4.0:** every placeholder glyph replaced by a real stroke-icon set drawn
  in `currentColor` — icons are exactly as legible as the text beside them in
  all 24 themes, automatically. Training scenarios no longer render dark on
  light themes, and a new automated contrast suite sweeps all 24 themes on
  every build (it caught and fixed a Forms-view button whose text was
  invisible in every theme, plus a low-contrast console line on four light
  themes).
- **1.4.1:** Quiz and Mock Board now feed the Board Drill's spaced-repetition
  schedule. A missed quiz question becomes due in the drill immediately
  (correct multiple-choice answers deliberately never advance recall);
  Mock Board self-scores move cards both ways. Plus MOS Career Center
  cross-links from the profile header and the Transition Career tab.

Every distribution fork of the same build, verified before packaging.
Integrity: check any file against `SHA256SUMS.txt`
(`sha256sum -c SHA256SUMS.txt` or `CertUtil -hashfile <file> SHA256`).

| File | Platform | Install |
|---|---|---|
| `GUIDON_1.4.1_x64-setup.exe` | **Windows** (PC) | Run it. Per-user install, no admin. SmartScreen will warn because it is unsigned — *More info → Run anyway*. |
| `GUIDON_1.4.1_x64_en-US.msi` | **Windows** (managed/GPO) | For scripted or enterprise deployment; same app as the .exe. |
| `GUIDON-1.4.1-portable.exe` | **Windows** (no install) | The bare desktop binary — run from anywhere, including a USB stick. |
| `GUIDON-1.4.1-release.apk` | **Android** (sideload) | Signed release build. Copy to the device and open, or `adb install`. |
| `GUIDON-1.4.1-release.aab` | **Android** (Play Store) | Upload bundle for a Play listing. Not installable directly. |
| `GUIDON-1.4.1-standalone.html` | **Any browser / offline** | The single-file fork: open it from disk, email it, put it on a share drive. Works from `file://` with no server and no network. Also deployable to any static host as an installable PWA. |

Verified by fifteen automated suites (build, promotion-point tables vs the
regulation, corpus consistency, accessibility tree, theme contrast, SRS
bridge, theater mode, flip animation, DA 4856 PDF, standalone `file://`,
desktop CSP, and more) plus NVDA screen-reader walks of the core flows.
