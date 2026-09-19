/**
 * tools/lint-capacitor-config.mjs, iOS half (checks d-i), proven to bite.
 *
 * Why: the iOS shell shipped a "Biometric lock" switch with no
 * NSFaceIDUsageDescription in Info.plist - iOS refuses Face ID without that
 * sentence, so the switch could never be turned on - and the only config lint
 * this repo had did not read a single iOS file. A lint that has never been
 * seen failing is a guess, so this suite copies the REAL committed iOS project
 * into a scratch directory, plants ONE defect at a time, runs the REAL lint
 * against the copy (--ios / --package / --workflow / --tracked) and requires
 * exit 1 with a FAIL line that names the check and the thing that is wrong.
 * It also puts back each defect this repo really had (no Face ID string, five
 * tracked cap-sync outputs, a stale Package.swift, a verifier step that could
 * not fail, no post-sync drift step) and requires red for every one of them.
 *
 * Pure node: no browser, no git, no Xcode - runs on any OS.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const LINT = path.join(HERE, "lint-capacitor-config.mjs");
const REAL = {
  plist: path.join(APP, "ios", "App", "App", "Info.plist"),
  pbx: path.join(APP, "ios", "App", "App.xcodeproj", "project.pbxproj"),
  spm: path.join(APP, "ios", "App", "CapApp-SPM", "Package.swift"),
  pkg: path.join(APP, "package.json"),
  workflow: path.resolve(APP, "..", ".github", "workflows", "ios.yml"),
};

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const scratch = await mkdtemp(path.join(os.tmpdir(), "guidon-ios-lint-"));
const text = {};
for (const [k, p] of Object.entries(REAL)) text[k] = (await readFile(p, "utf8")).replace(/\r\n/g, "\n");

// What git tracks under ios/ on a healthy tree: just the hand-maintained files.
const TRACKED_CLEAN = ["guidon-app/ios/.gitignore", "guidon-app/ios/App/App/Info.plist", "guidon-app/ios/App/App.xcodeproj/project.pbxproj", "guidon-app/ios/App/CapApp-SPM/Package.swift"];

let seq = 0;
/** Build a scratch copy with `edit` applied to the named texts, run the lint. */
async function lint(edit = {}, { tracked = TRACKED_CLEAN } = {}) {
  const dir = path.join(scratch, "case-" + (++seq));
  const ios = path.join(dir, "ios");
  await mkdir(path.join(ios, "App", "App"), { recursive: true });
  await mkdir(path.join(ios, "App", "App.xcodeproj"), { recursive: true });
  await mkdir(path.join(ios, "App", "CapApp-SPM"), { recursive: true });
  const t = { ...text };
  for (const [k, fn] of Object.entries(edit)) {
    const next = fn(t[k]);
    if (next === t[k]) throw new Error(`test bug: the planted "${k}" edit changed nothing - its anchor no longer matches the real file`);
    t[k] = next;
  }
  await writeFile(path.join(ios, "App", "App", "Info.plist"), t.plist);
  await writeFile(path.join(ios, "App", "App.xcodeproj", "project.pbxproj"), t.pbx);
  await writeFile(path.join(ios, "App", "CapApp-SPM", "Package.swift"), t.spm);
  await writeFile(path.join(dir, "package.json"), t.pkg);
  await writeFile(path.join(dir, "ios.yml"), t.workflow);
  await writeFile(path.join(dir, "tracked.txt"), tracked.join("\n") + "\n");
  const r = spawnSync(process.execPath, [LINT, "--ios", ios, "--package", path.join(dir, "package.json"), "--workflow", path.join(dir, "ios.yml"), "--tracked", path.join(dir, "tracked.txt")], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  return { code: r.status, out, failLines: out.split("\n").filter((l) => /^\s*FAIL\s/.test(l)) };
}

/** One planted defect: red, exactly the named check complains, and it says `needle`. */
async function expectRed(label, check, needle, edit, opts) {
  const r = await lint(edit, opts);
  const mine = r.failLines.filter((l) => l.includes(`(${check})`) && needle.test(l));
  const others = r.failLines.filter((l) => !l.includes(`(${check})`));
  if (r.code === 1 && mine.length && !others.length) ok(`${label}: red, check (${check}) names it`);
  else bad(`${label}: expected exit 1 with a (${check}) FAIL matching ${needle} and no other check complaining - got exit ${r.code}\n${r.failLines.join("\n") || r.out}`);
}

const FACE_ID = /\t<key>NSFaceIDUsageDescription<\/key>\n\t<string>[^<]*<\/string>\n/;

/* 0 - the committed project, through the same scratch-copy path, is green.
   Without this every "red" below could be the harness, not the defect. */
{
  const r = await lint();
  r.code === 0 && !r.failLines.length && /\(d\).*NSFaceIDUsageDescription/.test(r.out) && /\(i\).*drift/.test(r.out)
    ? ok("the committed iOS project passes every check (d-i) through the scratch-copy harness")
    : bad("the unmodified copy is not green:\n" + r.out);
  const direct = spawnSync(process.execPath, [LINT], { encoding: "utf8" });
  direct.status === 0 ? ok("...and the lint passes on the real tree with no arguments (the lint:patterns call)") : bad("lint on the real tree: exit " + direct.status + "\n" + direct.stdout);
}

/* (d) usage strings ------------------------------------------------------ */
// The defect that shipped: no Face ID sentence at all.
await expectRed("Info.plist without NSFaceIDUsageDescription (the state that shipped)", "d", /no NSFaceIDUsageDescription.*capacitor-biometric-auth/, { plist: (s) => s.replace(FACE_ID, "") });
await expectRed("the Face ID sentence left empty", "d", /NSFaceIDUsageDescription is ""/, { plist: (s) => s.replace(FACE_ID, "\t<key>NSFaceIDUsageDescription</key>\n\t<string></string>\n") });
await expectRed("the Face ID sentence left as a placeholder", "d", /NSFaceIDUsageDescription is "TODO/, { plist: (s) => s.replace(FACE_ID, "\t<key>NSFaceIDUsageDescription</key>\n\t<string>TODO write the Face ID reason here</string>\n") });
await expectRed("the key only inside an XML comment", "d", /no NSFaceIDUsageDescription/, { plist: (s) => s.replace(FACE_ID, (m) => "\t<!--\n" + m + "\t-->\n") });
await expectRed("the key only inside a nested dict (not top level)", "d", /no NSFaceIDUsageDescription/, {
  plist: (s) => { const m = s.match(FACE_ID)[0]; return s.replace(FACE_ID, "").replace(/(<key>UIApplicationSceneManifest<\/key>\n\t<dict>\n)/, "$1" + m); },
});
await expectRed("a camera usage string appears", "d", /declares NSCameraUsageDescription.*no camera/, { plist: (s) => s.replace(FACE_ID, (m) => m + "\t<key>NSCameraUsageDescription</key>\n\t<string>GUIDON would like to use the camera for something.</string>\n") });
await expectRed("a usage string no bundled plugin needs", "d", /declares NSCalendarsUsageDescription, which no bundled plugin/, { plist: (s) => s.replace(FACE_ID, (m) => m + "\t<key>NSCalendarsUsageDescription</key>\n\t<string>GUIDON would like to read your calendar for something.</string>\n") });
// (synced properly, so Package.swift links it too - only the missing decision is wrong)
await expectRed("a new Capacitor plugin nobody wrote down", "d", /no entry for: @capacitor\/camera/, {
  pkg: (s) => s.replace(/"@capacitor\/app":/, '"@capacitor/camera": "^8.0.0",\n    "@capacitor/app":'),
  spm: (s) => s.replace(/(\n\s*)(\.package\(name: "CapacitorApp", path: ")((?:\.\.\/)+node_modules\/)@capacitor\/app"\),/, '$1$2$3@capacitor/app"),$1.package(name: "CapacitorCamera", path: "$3@capacitor/camera"),'),
});

/* (e) App Transport Security --------------------------------------------- */
await expectRed("an App Transport Security exception", "e", /NSAppTransportSecurity/, {
  plist: (s) => s.replace(FACE_ID, (m) => m + "\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t</dict>\n"),
});

/* (f) project.pbxproj ---------------------------------------------------- */
await expectRed("one build configuration with a different bundle id", "f", /PRODUCT_BUNDLE_IDENTIFIER app\.guidon\.trainer\.dev does not match/, { pbx: (s) => s.replace(/PRODUCT_BUNDLE_IDENTIFIER = app\.guidon\.trainer;/, "PRODUCT_BUNDLE_IDENTIFIER = app.guidon.trainer.dev;") });
await expectRed("deployment target below the WebKit engine floor", "f", /IPHONEOS_DEPLOYMENT_TARGET 15\.0 is below the WebKit engine floor/, { pbx: (s) => s.replace(/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/g, "IPHONEOS_DEPLOYMENT_TARGET = 15.0;"), spm: (s) => s.replace(/\.iOS\(\.v\d+\)/, ".iOS(.v15)") });
await expectRed("an Info.plist privacy key injected from build settings", "f", /INFOPLIST_KEY_NSFaceIDUsageDescription/, { pbx: (s) => s.replace(/INFOPLIST_FILE = App\/Info\.plist;/, 'INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tINFOPLIST_KEY_NSFaceIDUsageDescription = "x";') });

/* (g) CapApp-SPM/Package.swift ------------------------------------------- */
// The stale state that was committed: .v15 beside a 16.2 deployment target.
await expectRed("Package.swift platforms .v15 beside a 16.x target (the state that was committed)", "g", /platforms \.iOS\(\.v15\).*write \.v16/, { spm: (s) => s.replace(/\.iOS\(\.v\d+\)/, ".iOS(.v15)") });
await expectRed("Package.swift pinning a runtime the lockfile does not install", "g", /pins capacitor-swift-pm 8\.0\.0 but package-lock\.json installs/, { spm: (s) => s.replace(/exact: "[^"]+"/, 'exact: "8.0.0"') });
await expectRed("a bundled plugin missing from Package.swift", "g", /not linked: @capacitor\/haptics/, { spm: (s) => s.replace(/\n[^\n]*node_modules\/@capacitor\/haptics"\),/, "") });

/* (h) cap-sync output stays untracked ------------------------------------ */
// The state that was committed: five generated files force-added.
await expectRed("the five cap-sync outputs tracked again (the state that was committed)", "h", /capacitor\.config\.json.*config\.xml.*capacitor-cordova-ios-plugins/, {}, {
  tracked: [...TRACKED_CLEAN, "guidon-app/ios/App/App/capacitor.config.json", "guidon-app/ios/App/App/config.xml",
    "guidon-app/ios/capacitor-cordova-ios-plugins/CordovaPluginsResources.podspec", "guidon-app/ios/capacitor-cordova-ios-plugins/resources/.gitkeep", "guidon-app/ios/capacitor-cordova-ios-plugins/sources/.gitkeep"],
});

/* (i) the workflow stays honest ------------------------------------------ */
const DRIFT_STEP = /\n      - name: Committed iOS project matches a fresh sync\n[\s\S]*?(?=\n\n      - name: Pick build destination)/;
// The state that was on main: a verifier step that cannot fail.
await expectRed("continue-on-error back on the WebKit verifier step (the state that was on main)", "i", /continue-on-error: true/, { workflow: (s) => s.replace(/(      - name: iOS WebKit verification\n)/, "$1        continue-on-error: true\n") });
await expectRed("continue-on-error on the whole WebKit job", "i", /continue-on-error: true/, { workflow: (s) => s.replace(/(    name: WebKit pre-flight\n)/, "$1    continue-on-error: true\n") });
await expectRed("the WebKit verifier step deleted", "i", /no longer runs the WebKit verifier/, { workflow: (s) => s.replace(/\n      - name: iOS WebKit verification\n        run: npm run ios:verify:shots\n/, "\n") });
await expectRed("no post-sync drift step (the state that was on main)", "i", /no post-sync drift step/, { workflow: (s) => s.replace(DRIFT_STEP, "") });
await expectRed("the drift step moved after the Xcode build", "i", /must run after `cap sync ios` and before the Xcode build/, {
  workflow: (s) => { const step = s.match(DRIFT_STEP)[0]; return s.replace(DRIFT_STEP, "").replace(/(\n\n      - name: Locate built app)/, step + "$1"); },
});

await rm(scratch, { recursive: true, force: true }).catch(() => {});
console.log(fails ? `\n${fails} FAILURE(S)` : "\nIOS CONFIG LINT: all passed");
process.exit(fails ? 1 : 0);
