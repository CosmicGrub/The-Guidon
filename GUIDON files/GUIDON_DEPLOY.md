# GUIDON — Build, Package & Deploy

**How to produce every shipping artifact, how to host it, and how each claim here was verified.**
Read `GUIDON_PROJECT_MAP.md` first for orientation; read this when you need to actually ship something.

Project root: `guidon-app/`
App version: **1.2.0** · Source build: `src/index.html` (formerly `guidon_86.html` / `guidon_index.html`)

---

## 1. What gets produced

One source file produces four distribution artifacts. Nothing is minified, restructured, or rewritten — the build makes targeted, asserted edits and fails loudly if an anchor is missing.

| Artifact | Size | What it's for |
|---|---|---|
| `dist/guidon-standalone.html` | 4.90 MB | **The hand-someone-the-file build.** Opens from `file://`, needs no siblings, no server, no network. This is the original promise and it is preserved exactly. |
| `web/` | 4.06 MB + 896 KB assets | **The installable bundle.** Host it, or feed it to the native wrappers. Installs as a real app on Android, iOS, Windows and macOS. |
| `dist/desktop/GUIDON_1.2.0_x64-setup.exe` | 2.34 MB | Windows installer (NSIS, per-user, no admin needed). |
| `dist/desktop/GUIDON_1.2.0_x64_en-US.msi` | 2.77 MB | Windows installer (MSI, for managed/GPO deployment). |
| `android/app/build/outputs/apk/` | — | Android APK (see §6). |

---

## 2. Build commands

```bash
cd guidon-app
npm install
npm run build          # -> web/ and dist/guidon-standalone.html
npm test               # build + all four verification suites
```

| Command | Does |
|---|---|
| `npm run build` | Produces `web/` and `dist/guidon-standalone.html` |
| `npm run icons` | Re-renders app icons from vector source (uses Chromium, no image library) |
| `npm run verify` | 27-check sweep: installability, service worker, real offline, 29 routes × 6 viewports |
| `npm run test:pdf` | Generates a real DA 4856 and inspects the bytes, online and offline |
| `npm run test:standalone` | Proves the single file works from `file://` with zero external requests |
| `npm run test:csp` | Runs the bundle under the exact desktop Content-Security-Policy |
| `npm run perf` | Measures per-payload boot cost under CPU throttling |
| `npm run desktop:build` | Windows `.exe` + `.msi` |
| `npm run android:debug` | Android APK |

---

## 3. Hosting the web bundle

Upload the **contents of `web/`** to any static host — GitHub Pages, Netlify, Cloudflare Pages, or a unit web server. There is no server code, no database and no build step on the host.

```
web/
  index.html              4.06 MB   the app
  sw.js                             service worker (cache-versioned by content hash)
  manifest.webmanifest              install metadata
  icons/                            PNG + maskable + apple-touch
  assets/pdf-lib.js       525 KB    loaded on demand
  assets/da4856.js        371 KB    loaded on demand
```

**Two things the host must get right:**

1. **Serve `sw.js` with `Cache-Control: no-cache`.** If the service worker script itself is cached aggressively, users can be stranded on an old build. Every other file may be cached freely — the SW is versioned by a content hash of `index.html`, so a new build always produces a new cache generation and always triggers the update prompt.
2. **Turn on gzip or brotli.** Measured: 4.89 MB raw → **1.47 MB gzip** → **1.18 MB brotli**. Most hosts do this automatically; if yours does not, enable it.

**HTTPS is required** for installation and for service workers. `http://localhost` is exempt for testing.

---

## 4. What "installable" now actually means

Before this work the app had a `data:` URI manifest and a service worker that could never register — `registerSW()` returned early on `window.GUIDON_SINGLEFILE`, which is always true. A hosted copy therefore had **no offline capability at all**, and Chromium will not install from a `data:` manifest.

Now, verified by automated test rather than asserted:

- Manifest is a real same-origin file with PNG icons at 192 and 512, plus **separate** maskable entries. (An icon declaring `"purpose": "any maskable"` gets cropped as maskable on Android — these are declared separately.)
- `apple-touch-icon` present, so iOS uses a real icon rather than a screenshot.
- Service worker precaches 9 entries and **the app reloads and boots with the network disabled** — this is asserted by actually cutting the network in the test, not by checking that a worker exists.
- `navigator.storage.persist()` is requested at boot and again on `appinstalled`. This is the real mitigation for the iOS ~7-day IndexedDB eviction that §42 of the masterfile documents; until now the app only *warned* about it.
- An **Install** button appears in Share & Install when the browser offers one, and the panel reports honest state — installed / installable / offline-ready / storage-durability — rather than claiming capability it has not checked.
- Updates never swap in under a Soldier mid-drill. A new build is detected, announced, and applied only when the user chooses.

---

## 5. Windows desktop app

Built with **Tauri 2** (Rust + the system WebView2). Chosen over Electron because the whole installer is **2.34 MB** rather than ~150 MB, and WebView2 ships with Windows 11.

```bash
npm run desktop:build
```

Requires the Rust toolchain (`x86_64-pc-windows-msvc`). Output lands in `src-tauri/target/release/bundle/`.

**Verified end-to-end, not just "it compiled":**
- Process launches, holds the correct window title, 35 threads, **27 MB** resident.
- WebView2 created `IndexedDB/http_tauri.localhost_0.indexeddb.leveldb` containing database `guidon` with object stores `kv`, `meta`, `userScenarios`, `attempts` — plus real writes (`legacyStorageMigration:v1`, `streak:v1`). The app booted and ran its data layer; it is not a blank window.
- The bundle was separately run under the **exact CSP** from `tauri.conf.json`: 29 routes render, the deferred PDF stack loads and generates, blob downloads work, IndexedDB works, zero violations.

The desktop shell adds no *app* behaviour — it exists to give the offline web build a real window, a Start-menu entry and its own storage. It makes no network calls. It does add two things a Windows application is expected to do:

- **Remembers its window.** Size, position and maximised state persist between runs, so someone who studies on a second monitor does not reposition it daily.
- **Single instance.** Launching GUIDON again from the Start menu, a desktop shortcut or a pinned taskbar icon raises the window that is already open instead of starting a second copy fighting over the same IndexedDB.

### Not done: Windows code signing

The installer is **unsigned**, so Windows SmartScreen will show a "Windows protected your PC" warning on first run, and the user must click *More info → Run anyway*. This is expected for an unsigned installer and is not a defect in the build.

Removing it requires an Authenticode certificate from a CA (roughly $200–400/yr, or an EV certificate for immediate SmartScreen reputation). Worth doing before any wide distribution; not worth it for handing the installer to a squad. Once you have a `.pfx`, Tauri signs during bundling via `bundle.windows.certificateThumbprint` in `tauri.conf.json`.

---

## 6. Android app

Built with **Capacitor 8**. The APK embeds the same `web/` bundle, so the app is fully offline with no hosting required.

```bash
npm run android:debug     # debug APK, directly sideloadable
```

Requires a JDK and the Android SDK (compileSdk 36). Android Studio's bundled JBR 21 works.

### Verified on a real Android runtime

Installed and launched on an Android 14 emulator, then driven over the DevTools bridge. Playwright's `connectOverCDP` **cannot** attach to Android WebView — it needs browser-level endpoints WebView does not implement — so `tools/cdp.mjs` speaks raw DevTools Protocol to the page target:

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof app.guidon.trainer)
node tools/test-android.mjs
```

Against WebView **Chrome 113**, deliberately older than a Tab S9 FE would run: 29 routes, zero overflow at 1280 px, zero console output, `data-display-mode="native"`, IndexedDB working, **no service worker registered** (correct — APK assets are already local; `window.Capacitor` is present before `pwa.js` runs), and a **real 43,914-byte DA 4856 exported from APK assets** with the PDF stack still deferred at boot.

Still worth a sideload on the actual tablet: an emulator has neither the S Pen hover the app supports (§17) nor the 90 Hz panel.

```bash
npm run android:release   # signed release APK + AAB (Play Store bundle)
```

### Native shell integration

Three things separate "a web page in a wrapper" from an app, all handled in `src/native.js` and the Android resources:

- **System bars follow the active theme.** GUIDON has 24 themes, 5 of them light. A fixed status-bar colour is wrong for at least 19 of them, and a light theme under a dark bar reads instantly as a wrapped page. The bar colour is read from the app's own `--bg` token and the icon contrast is computed from that colour's WCAG relative luminance, not guessed per theme. Verified switching light↔dark on-device: `#e8dfc9 ⇄ #0a0e12`.
- **Branded splash.** Android 12+ uses the SplashScreen API (`windowSplashScreenBackground` + the app icon); Android 7–11 uses full-bleed drawables, regenerated at all 11 densities by `npm run splash`. The adaptive-icon background was also `#fff`, which showed white behind the mark once the launcher applied its mask — now brand dark.
- **Back button** — see below.

### The Back button was broken, and only a device showed it

With `@capacitor/app` installed, Android's Back delivered `{canGoBack:false}` to the web layer **even with `history.length` at 33**, and Capacitor took no default action. The result: Back did *nothing* — it neither navigated nor exited, which on Android reads as a broken app.

`canGoBack` reflects WebView *document* navigation. GUIDON is a hash router, so it is simply the wrong signal. `src/native.js` now tracks its own navigation depth and implements the correct Android contract:

1. a themed dialog is open → close it (by dispatching Escape, reusing `G.modal`'s own tested close path rather than poking at its internals)
2. depth > 0 → `history.back()`
3. at the root → `App.exitApp()`

The router assigns an initial hash at boot; counting that would make the first Back land on a hash-less URL that `start()` immediately re-routes — a Back button that never exits. Depth therefore baselines after boot.

Verified on-device and automated as `npm run test:android:back`:
`#/progress → #/board → #/home → app exits, launcher regains focus`.

### Signing

A release keystore **has** been generated at `keys/guidon-release.jks`, with credentials in `android/keystore.properties`. Both are git-ignored.

> **Back up the `.jks` file and move the password into a password manager.** The package name is permanently bound to this key: if it is lost, Google Play will never accept another update to a published app. `keystore.properties` is a convenience for local builds, not a safe long-term home for the password.

If `keystore.properties` is absent the release build stays unsigned rather than failing, so a fresh clone can still run `assembleDebug`.

### A note on the path trap

`android/local.properties` must use **forward slashes**:

```
sdk.dir=C:/Users/you/AppData/Local/Android/Sdk
```

Java `.properties` files treat backslash as an escape character, so `C\:\Users\...` silently parses as `C:UsersOblivAppData...` and Gradle fails with a bare `java.io.IOException: Invalid file path` that names no path. This cost a build cycle here; it looks like a Gradle bug and is not one.

---

## 7. iOS

Not buildable on Windows — compiling for iOS requires macOS with Xcode and a $99/yr Apple Developer account. Two paths:

- **Home-screen app (works today, no Mac, no account).** Open the hosted URL in Safari → Share → Add to Home Screen. The `apple-touch-icon`, standalone display and status-bar styling are all in place, and `storage.persist()` is requested. This is a genuinely good iOS experience and costs nothing.
- **Native App Store build.** `npx cap add ios` on a Mac produces the Xcode project from this same repo. Everything except the Mac-side build is already prepared.

---

## 8. Performance, measured

Median of 3 cold loads at 412×915, CPU-throttled to approximate real hardware (`npm run perf`):

| Payload | 1× (desktop) | 4× (mid-range) | 6× (budget) |
|---|---|---|---|
| Full build, DomContentLoaded | 99 ms | 463 ms | 744 ms |
| Saving from deferring the PDF stack | 22 ms | 81 ms | **113 ms** |
| Saving from deferring `GUIDON_SEED` | 57 ms | 215 ms | **329 ms** |

**First Contentful Paint is essentially unchanged across every variant** (~130–180 ms) — the app already paints before the heavy scripts parse. The cost is time-to-interactive, not time-to-pixels.

**Done:** the PDF stack (pdf-lib + the two embedded DA 4856 forms, 896 KB) is extracted to `web/assets/` and loaded only when a counseling form is actually exported. It is still precached, so offline export works — verified by generating a PDF with the network cut.

**Not done:** deferring the 3.26 MB `GUIDON_SEED`. It is the larger win (~329 ms) but every module reads it, it has been flagged across many sessions as needing its own dedicated session, and it is not worth risking the correctness of a study app on a change that cannot be fully re-validated in one pass. The number is recorded here so the decision is informed rather than forgotten.

---

## 9. Verification standard

All four suites use Playwright against a real HTTP origin and follow this project's standing rules:

- **Console `warning` is captured, not just `error`.** A `ReferenceError` once hid for two full sessions behind an error-only filter.
- **The section list is derived from `G.routes`**, never hand-maintained — a hand-copied list silently fell three sections behind once already. (It is **29 routes**, not the 26 the project map still claims.)
- **Settle after theme changes as well as navigation**, longer than the longest CSS transition, before sampling anything colour-related.
- **One known console message is allow-listed**, with the reason recorded: vendored pdf-lib logs `Removing XFA form data…` whenever it loads the real DA 4856. This was confirmed to be **pre-existing** by generating a PDF from the untouched original build and observing the identical message — not assumed to be harmless.

Current status: **27/27 verify · PDF suite all passed · standalone suite all passed · CSP suite all passed.**
