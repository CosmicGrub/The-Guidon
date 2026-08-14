# GUIDON — packaging

Turns the single-file GUIDON app into an installable application on phone and PC,
without giving up the "hand someone one .html file" promise.

**Read `../GUIDON files/GUIDON_DEPLOY.md` for the full guide.**

```
src/index.html      the app (single-file source of truth)
src/app-modules/    app CONTENT modules, injected into BOTH builds
                      fitness.js  AFT combat standard + Combat Field Test
                      records.js  pre-board records readiness checklist
src/pwa.js          install / offline / storage-durability (G.pwa)      web only
src/pdf-defer.js    on-demand loader for the DA 4856 stack (G.pdfAssets) web only
src/native.js       Android shell: system bars, Back button (G.native)   web only
src/sw.js           service worker template (version injected at build)
tools/              build + 39 verification suites (see package.json's "test" script)
web/                BUILD OUTPUT - installable bundle (do not hand-edit)
dist/               shippable artifacts
src-tauri/          Windows desktop app
android/            Android app (Capacitor)
```

`src/app-modules/*.js` is application content, so it goes into the standalone
build too; `pwa.js`/`native.js`/`pdf-defer.js` are packaging and are web-only.
Adding a module means dropping a file in `app-modules/` and adding one line to
`ROUTES` and one to `NAV_GROUPS` in `src/index.html`. Route render callbacks are
lazy arrows, and the shell defers `app.start()` to `DOMContentLoaded`, so a
module injected after the shell is still defined in time.

## Quick start

```bash
npm install
npm run build     # -> web/ and dist/guidon-standalone.html
npm test          # lint + build + verify + full suite battery (39 suites, see package.json)
```

Device suites (`test:android`, `test:android:back`) need a running device or
emulator. `test:android` also needs the DevTools bridge — note this only works
against a **debug** build; release builds disable WebView debugging:

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof app.guidon.trainer)
```

## Shipping

```bash
npm run desktop:build     # Windows .exe + .msi
npm run android:release   # signed APK + AAB
```

> **Back up `keys/guidon-release.jks` and move its password out of
> `android/keystore.properties` into a password manager.** The package name is
> permanently bound to that key — lose it and Google Play will never accept
> another update to a published app. Both paths are git-ignored.

The Windows installer is **unsigned**, so SmartScreen warns on first run. That is
expected, not a defect; it needs an Authenticode certificate to go away.

## Two artifacts, on purpose

`web/index.html` links a real `manifest.webmanifest` and registers a service worker —
neither of which can work from `file://`, and a missing sibling manifest would log a
404. So `dist/guidon-standalone.html` keeps everything inline and stays exactly as
shippable-by-email as it has always been. Both are built from the same source and
both are tested.

## Rules worth not relearning

- **Never anchor a build edit on `</body>`.** Markup-shaped strings live inside the
  JS in this file; the print-summary code emits a literal `</body></html>`. Anchor on
  the document terminator. Every replacement in `tools/build.mjs` fails loudly if it
  does not match exactly once.
- **`android/local.properties` needs forward slashes.** Java `.properties` treats
  backslash as an escape, so `C\:\Users\…` silently becomes `C:UsersObliv…` and
  Gradle dies with a bare `Invalid file path` that names no path.
- **Playwright cannot attach to Android WebView.** Use `tools/cdp.mjs`.
- **Capture console `warning`, not just `error`** — a `ReferenceError` once hid behind
  an error-only filter for two full sessions of this project.
- **Never pipe a build through `| tail -N`.** It hides the real error *and* replaces
  the build's exit code with `tail`'s. Gradle's `BUILD FAILED` was reported as
  exit 0 twice before this stuck.
- **`file()` in `android/app/build.gradle` resolves from the app module**, not the
  project root. Use `rootProject.file()`.
- **The Tauri window-state plugin saves on graceful close, not on kill.**
  `Stop-Process -Force` writes no state file and looks exactly like a plugin bug.
- **Reasoning about a platform is not evidence about a platform.** The Android
  Back button was documented as "Capacitor's default is correct here" and was in
  fact doing nothing at all. A device settled it in one test.
