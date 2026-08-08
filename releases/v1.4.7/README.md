# GUIDON v1.4.7 — release artifacts

**New in 1.4.7 — 16 findings from a 44-agent deep UX/config-combo audit,
batched into one release.** Five orphan-text widows fixed (a stranded word
alone on its own line at phone width, on prominent headings and a
destructive-sounding "delete" button). The BRS & TSP tab's five sibling
panels had inconsistent gaps — one stray CSS rule left two of four joins
sitting flush while the other two had proper breathing room, reproduced and
fixed at phone, tablet, and desktop widths. A title-plus-status-badge layout
bug on the Calendar and Currency pages — a long title pushed the whole badge
onto its own line instead of just wrapping the title — found a third,
unflagged copy of itself in the Records overdue list on the way to fixing
it. The Progress page's LRM Balance radar chart clipped 4 of its 6 axis
labels at every screen size (outside the audit's own scope, kept anyway
because it was real). The High Contrast toggle's border boost turned out to
be two unrelated bugs sharing one symptom: ten themes lost the boost to a
CSS cascade tie, one theme (Blackout) never had that bug at all and needed
an actual color fix. Reduced Motion zeroed animation durations everywhere
but had missed one class of leftover delay, so the Train list's card
entrance still visibly staggered on every search keystroke even with motion
reduced — now fully suppressed.

Every distribution fork of the same build, verified before packaging.
Integrity: check any file against `SHA256SUMS.txt`
(`sha256sum -c SHA256SUMS.txt` or `CertUtil -hashfile <file> SHA256`).

| File | Platform | Install |
|---|---|---|
| `GUIDON_1.4.7_x64-setup.exe` | **Windows** (PC) | Run it. Per-user install, no admin. SmartScreen will warn because it is unsigned — *More info → Run anyway*. |
| `GUIDON_1.4.7_x64_en-US.msi` | **Windows** (managed/GPO) | For scripted or enterprise deployment; same app as the .exe. |
| `GUIDON-1.4.7-portable.exe` | **Windows** (no install) | The bare desktop binary — run from anywhere, including a USB stick. |
| `GUIDON-1.4.7-release.apk` | **Android** (sideload) | Signed release build. Copy to the device and open, or `adb install`. Same signing key as every prior release — installs as an update, no data loss. |
| `GUIDON-1.4.7-release.aab` | **Android** (Play Store) | Upload bundle for a Play listing. Not installable directly. |
| `GUIDON-1.4.7-standalone.html` | **Any browser / offline** | The single-file fork: open it from disk, email it, put it on a share drive. Works from `file://` with no server and no network. Also deployable to any static host as an installable PWA. |

Verified by sixteen automated suites plus a dedicated Playwright pass
covering all 16 findings individually, each re-measured against the rebuilt
bundle rather than trusted from the audit's own numbers.
