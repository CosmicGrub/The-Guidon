# GUIDON — Army Leader Development Trainer

Offline-first study and career tool for enlisted Soldiers, E1–E9. One codebase
ships four ways: a single HTML file that runs from `file://` with zero setup, an
installable PWA, a Windows desktop app (Tauri), and an Android app (Capacitor).
No accounts, no network calls, no telemetry — every byte of study data stays on
the device.

**35 sections** across board prep, the full NCOPDS ladder (BLC → SMC), promotion
points, fitness standards, records readiness, assignments, counseling, finance
and transition. **1,014 board cards** with 4-level spaced-repetition grading,
a **3,629-term** dictionary, **336 doctrine entries**, and a DA 4856 exporter
that fills the real form.

Policy content is built from primary sources — AR 600-8-19 (6 March 2026),
Army Directives 2026-07 and 2026-13, the BLC ISAP — and the promotion-point
tables are unit-tested against the regulation text. The in-app **Currency**
section shows how old each policy area is and who to confirm it with, because
2026 has repeatedly proven that anything less rots silently.

## Platforms — every fork of the build

| Fork | Get it | Built from |
|---|---|---|
| **Windows (PC)** | [`releases/v1.4.6/GUIDON_1.4.6_x64-setup.exe`](releases/v1.4.6/) — per-user installer, no admin. MSI alongside for managed deployment. | [`guidon-app/src-tauri/`](guidon-app/src-tauri/) (Tauri 2, ~2.4 MB) |
| **Android** | [`releases/v1.4.6/GUIDON-1.4.6-release.apk`](releases/v1.4.6/) — signed, sideloadable. AAB alongside for a future Play listing. | [`guidon-app/android/`](guidon-app/android/) (Capacitor 8) |
| **Web / PWA** | Host the built `web/` bundle on any static server — installs as an app on Android, Windows and iOS, works offline after first load. | [`guidon-app/src/`](guidon-app/src/) + service worker |
| **Single file** | [`releases/v1.4.6/GUIDON-1.4.6-standalone.html`](releases/v1.4.6/) — open from disk, no server, no network, no install. | same source, build variant |
| iOS/macOS | On the backburner by design. Safari → Add to Home Screen covers Apple devices via the web fork today; a native build needs a Mac. | — |

All forks are the same app from the same `src/index.html` — one content fix
lands everywhere on the next build. Checksums: [`releases/v1.4.6/SHA256SUMS.txt`](releases/v1.4.6/SHA256SUMS.txt).

## Repository layout

| Path | What it is |
|---|---|
| [`guidon-app/`](guidon-app/) | Source and build. Start at its README. |
| [`GUIDON files/`](GUIDON%20files/) | Canonical project docs: masterfile (session-by-session history and reasoning), changelog, machine-readable state, deploy guide, design system. |
| [`releases/`](releases/) | Versioned, checksummed artifacts for every platform fork. |

## Quick start

```bash
cd guidon-app
npm install
npm run build     # -> dist/guidon-standalone.html and web/
npm test          # sixteen verification suites
```

Full build, packaging, hosting and signing instructions:
[`GUIDON files/GUIDON_DEPLOY.md`](GUIDON%20files/GUIDON_DEPLOY.md).

## Two rules that keep this repo safe

- **Signing material never lands here.** `keys/`, `keystore.properties`, and
  every keystore extension are blocked by the root `.gitignore`. The Android
  package name is permanently bound to its key — treat the keystore like a
  password, including in a private repo.
- **Source is LF, always.** The build locates its edit points with exact string
  anchors, and a CRLF conversion has broken it before. `.gitattributes`
  enforces this; do not fight it.

## Status

v1.4.6 · verified by sixteen automated suites (build, promotion-point tables vs
the regulation, corpus consistency, accessibility tree, DA 4856 PDF, standalone
`file://`, desktop CSP, and more) plus NVDA screen-reader walks of the core
flows. Built and tested on Windows, Android 14 (emulator + device), and six
real device viewports from a folded Z Fold 5 to desktop.
