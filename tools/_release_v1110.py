from pathlib import Path
import re

def must_replace(path, old, new, count=1):
    p=Path(path); s=p.read_text()
    n=s.count(old)
    if n != count: raise SystemExit(f'{path}: expected {count} copies of {old!r}, found {n}')
    p.write_text(s.replace(old,new))

must_replace('guidon-app/package.json', '"version": "1.10.1"', '"version": "1.11.0"')
must_replace('guidon-app/package-lock.json', '"version": "1.10.1"', '"version": "1.11.0"', 2)
must_replace('guidon-app/src-tauri/tauri.conf.json', '"version": "1.10.1"', '"version": "1.11.0"')
must_replace('guidon-app/src-tauri/Cargo.toml', 'version = "1.10.1"', 'version = "1.11.0"')
p=Path('guidon-app/src-tauri/Cargo.lock'); s=p.read_text()
pat='[[package]]\nname = "guidon"\nversion = "1.10.1"'
if s.count(pat)!=1: raise SystemExit('Cargo.lock guidon anchor mismatch')
p.write_text(s.replace(pat,'[[package]]\nname = "guidon"\nversion = "1.11.0"'))
must_replace('guidon-app/android/app/build.gradle','versionCode 11001','versionCode 11100')
must_replace('guidon-app/android/app/build.gradle','versionName "1.10.1"','versionName "1.11.0"')
must_replace('guidon-app/ios/App/App.xcodeproj/project.pbxproj','MARKETING_VERSION = 1.10.1;','MARKETING_VERSION = 1.11.0;',2)
must_replace('guidon-app/ios/App/App.xcodeproj/project.pbxproj','CURRENT_PROJECT_VERSION = 2;','CURRENT_PROJECT_VERSION = 3;',2)

idx=Path('guidon-app/src/index.html'); s=idx.read_text()
needle='''      {\n        version: "1.10.1",\n        date: "September 2026",\n        title: "Apple parity and release reliability",\n        highlights: [\n          "GUIDON now maintains a first-class iOS project that stays synced to the same app bundle and study experience as the web, Android, Windows, and macOS versions.",\n          "macOS releases now include a universal Apple Silicon + Intel package built from the same tagged source as the other platforms.",\n          "Apple-device verification now covers compact iPhone, standard iPhone, large iPhone, and iPad layouts with preserved render evidence and safer handling of transient Simulator failures.",\n        ],\n      },\n'''
if s.count(needle)!=1: raise SystemExit('Whats New 1.10.1 anchor mismatch')
entry='''      {\n        version: "1.11.0",\n        date: "September 2026",\n        title: "Board depth, OPSEC safeguards, and adaptive memorization",\n        highlights: [\n          "Promotion-board study now includes the full new core and 92A question set, with logistics-focused practice available throughout Board Drill, quizzes, weak-area review, group study, and the handheld flashcard export.",\n          "New Cybersecurity & OPSEC study material adds practical scenarios, board questions, key terms, and a self-check, while MOI and roster tools add stronger warnings and local safeguards against sensitive information.",\n          "Spirit of the CAV is now available as memorization material, with an optional Adaptive Recall Ladder that starts off disabled and never replaces your existing study methods.",\n          "This release is packaged from one tagged source across web/PWA and standalone, Android, Windows, macOS, iOS parity verification, and the ESP32 flashcard fork.",\n        ],\n      },\n'''
idx.write_text(s.replace(needle,needle+entry))

ch=Path('GUIDON files/CHANGELOG.md'); s=ch.read_text()
marker='All notable changes to GUIDON will be documented in this file. Format loosely follows [Keep a Changelog](http://keepachangelog.com/). This is the technical record for developers - the app itself shows a short, plain-language summary of each release to Soldiers directly (G.whatsNew, src/index.html), not this file.\n\n'
if s.count(marker)!=1: raise SystemExit('CHANGELOG marker mismatch')
centry='''## 2026-09-17 - v1.11.0: Board depth, OPSEC safeguards, and adaptive memorization\n\n**Promotion-board depth.** PR #177 integrates the complete 112-card source intake / 224 Q&A prompts, dedicated 92A coverage, two logistics scenarios, the ESP32 exporter, and permanent intake auditing.\n\n**OPSEC/cyber safeguards.** PR #178 adds the local-only ingestion guard/disclaimer, MOI and roster persistence safeguards, the Study Rooms official-network warning, the Cybersecurity & OPSEC study route, scenarios/self-check, and the command/legal review package without claiming regex redaction declassifies information or that the app is legally certified.\n\n**Optional memorization expansion.** PR #179 adds Spirit of the CAV and the default-off Adaptive Recall Ladder while preserving existing Recitation/SRS study methods.\n\n**Android signer continuity.** APK and AAB publication is pinned to the historically consistent GUIDON signing certificate and fails hard on identity drift.\n\n**Full-fork release scope.** The immutable v1.11.0 tag is the source for web/PWA + standalone, Android APK/AAB, Windows MSI/EXE, universal macOS DMG, tagged iOS Simulator package/evidence, and ESP32 Flashcard OS firmware + board-card content. Physical-device iOS distribution still requires Apple Developer credentials and is not represented as a shippable IPA.\n\n'''
ch.write_text(s.replace(marker,marker+centry))

rp=Path('GUIDON files/ROADMAP.md'); s=rp.read_text()
pattern=r'\*\*Current version:\*\* v1\.10\.0 \(`guidon-app/package\.json`\), cut 2026-09-16 —[^\n]*\n'
repl='**Current version:** v1.11.0 (guidon-app/package.json), prepared 2026-09-17 — PR #177 board/92A expansion, PR #178 OPSEC/cyber/legal harmonization, and PR #179 Spirit of the CAV + optional Adaptive Recall Ladder. One immutable tag feeds web/PWA + standalone, Android, Windows, macOS, iOS Simulator parity, and the ESP32 firmware/content fork. See CHANGELOG.md for distribution boundaries.\n'
s2,n=re.subn(pattern,repl,s,count=1)
if n!=1: raise SystemExit('ROADMAP current-version anchor mismatch')
rp.write_text(s2)

# Extend native release fan-out with web/standalone/ESP32 tag-pinned assets.
wf=Path('.github/workflows/release-assets.yml'); s=wf.read_text()
if 'name: Web/PWA + standalone + ESP32' not in s:
    s += '''\n\n  web_firmware:\n    name: Web/PWA + standalone + ESP32\n    needs: resolve\n    runs-on: ubuntu-latest\n    timeout-minutes: 60\n    env:\n      VERSION: ${{ needs.resolve.outputs.version }}\n      TAG: ${{ needs.resolve.outputs.tag }}\n      GH_TOKEN: ${{ github.token }}\n    steps:\n      - name: Checkout release tag\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        with:\n          ref: ${{ needs.resolve.outputs.tag }}\n          fetch-depth: 0\n      - name: Setup Node\n        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020\n        with:\n          node-version: ${{ env.NODE_VERSION }}\n          cache: npm\n          cache-dependency-path: guidon-app/package-lock.json\n      - name: Build and verify web + standalone\n        working-directory: guidon-app\n        run: |\n          set -euo pipefail\n          npm ci\n          npx playwright install --with-deps chromium\n          npm run icons\n          npm run build\n          npm run verify\n          npm run test:standalone\n      - name: Export ESP32 cards and build Flashcard OS\n        run: |\n          set -euo pipefail\n          cd firmware/esp32-flashcard-os\n          node tools/extract-cards.mjs\n          python3 -m pip install --user platformio\n          python3 -m platformio run -e flashcardos\n          test -s .pio/build/flashcardos/firmware.bin\n          test -s .pio/build/flashcardos/bootloader.bin\n          test -s .pio/build/flashcardos/partitions.bin\n          test -s sdcard/cards.ndjson\n          test -s sdcard/categories.json\n      - name: Package full-fork assets\n        run: |\n          set -euo pipefail\n          mkdir -p release-out\n          (cd guidon-app/web && zip -qr "../../release-out/GUIDON-${VERSION}-web-pwa.zip" .)\n          cp guidon-app/dist/guidon-standalone.html "release-out/GUIDON-${VERSION}-standalone.html"\n          cp firmware/esp32-flashcard-os/.pio/build/flashcardos/firmware.bin "release-out/GUIDON-${VERSION}-esp32-flashcardos.bin"\n          cp firmware/esp32-flashcard-os/.pio/build/flashcardos/bootloader.bin "release-out/GUIDON-${VERSION}-esp32-bootloader.bin"\n          cp firmware/esp32-flashcard-os/.pio/build/flashcardos/partitions.bin "release-out/GUIDON-${VERSION}-esp32-partitions.bin"\n          cp firmware/esp32-flashcard-os/sdcard/cards.ndjson "release-out/GUIDON-${VERSION}-esp32-cards.ndjson"\n          cp firmware/esp32-flashcard-os/sdcard/categories.json "release-out/GUIDON-${VERSION}-esp32-categories.json"\n      - name: Publish web/standalone/ESP32 assets\n        run: gh release upload "$TAG" --repo "$GITHUB_REPOSITORY" --clobber release-out/*\n'''
    wf.write_text(s)

# Publish an explicitly Simulator-only iOS package from the tagged source.
wf=Path('.github/workflows/release-apple.yml'); s=wf.read_text()
anchor='      - name: Upload iOS tagged evidence\n        if: always()\n'
if 'Publish iOS Simulator package' not in s:
    if anchor not in s: raise SystemExit('release-apple anchor mismatch')
    step='''      - name: Publish iOS Simulator package\n        env:\n          VERSION: ${{ needs.resolve.outputs.version }}\n          TAG: ${{ needs.resolve.outputs.tag }}\n          GH_TOKEN: ${{ github.token }}\n        run: |\n          set -euo pipefail\n          OUT="GUIDON-${VERSION}-ios-simulator.zip"\n          ditto -c -k --sequesterRsrc --keepParent "${{ steps.app.outputs.path }}" "$OUT"\n          gh release upload "$TAG" --repo "$GITHUB_REPOSITORY" --clobber "$OUT"\n'''
    wf.write_text(s.replace(anchor,step+anchor))

Path('.release-ci-kick').write_text('v1.11.0\n')
