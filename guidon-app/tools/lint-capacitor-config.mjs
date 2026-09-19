/**
 * Capacitor / Android / iOS config invariant for the "No server, ever" promise
 * (desktop roadmap P1, locked decision Q1). The promise says the only ways
 * a GUIDON fork touches a network are LAN study rooms (opt-in), GitHub
 * Pages (fetching the app itself), OS voice packs and OS backups. The
 * Android shell can silently widen that: a plaintext androidScheme, mixed
 * content, Capacitor's native HTTP bridge, or a new dangerous permission
 * would each be one line in a config nobody reads at review time. This
 * makes every one of them a `npm run lint:patterns` failure.
 *
 * Checks (PASS/FAIL lines, exit 1 on any FAIL, style of lint-patterns.mjs):
 *   (a) capacitor.config.json: server.androidScheme === "https",
 *       android.allowMixedContent === false,
 *       plugins.CapacitorHttp.enabled === false.
 *   (b) AndroidManifest.xml declares android.permission.INTERNET exactly once.
 *   (c) the manifest's complete <uses-permission> set equals ALLOWED_PERMISSIONS
 *       below - nothing missing, nothing extra - and never CAMERA,
 *       RECORD_AUDIO, ACCESS_FINE_LOCATION or any BLUETOOTH* permission.
 *
 * ALLOWED_PERMISSIONS was derived by reading the manifest once (2026-09-04):
 * INTERNET (the WebView serving itself over loopback; later also LAN rooms)
 * and VIBRATE (haptics, task #204). It is deliberately an exact allow-list,
 * not a deny-list: P4 (room discovery - multicast/NSD/Bluetooth are all
 * permissions) and P6 (read-aloud / camera / anything else) MUST edit this
 * lint in the SAME change that adds a permission, and say why there, or the
 * lint fails. That is the point.
 *
 * The iOS shell gets the same discipline (audit C52/U7/U9, R12). It had none,
 * which is how the app shipped a "Biometric lock" switch on iOS with no
 * NSFaceIDUsageDescription in Info.plist - the one string without which iOS
 * refuses Face ID outright - and nothing noticed, because the Simulator gate
 * only proves the first screen painted:
 *   (d) ios/App/App/Info.plist carries EXACTLY the usage strings the bundled
 *       Capacitor plugins need (PLUGIN_USAGE below, keyed on package.json
 *       dependencies) - none missing, none extra, none empty - and never a
 *       camera / microphone / location / Bluetooth / tracking string.
 *   (e) no NSAppTransportSecurity key at all: an ATS exception is the iOS
 *       spelling of Android's cleartext / mixed-content switches in (a).
 *   (f) project.pbxproj: every PRODUCT_BUNDLE_IDENTIFIER equals
 *       capacitor.config.json's appId (and the desktop shell's identifier);
 *       every IPHONEOS_DEPLOYMENT_TARGET agrees and is not below the WebKit
 *       engine floor (tools/engine-floor.json); Info.plist is the one the
 *       target really uses (no generated plist, no INFOPLIST_KEY_* override).
 *   (g) the committed CapApp-SPM/Package.swift is what `cap sync` would write
 *       from the lockfile: its capacitor-swift-pm pin equals package-lock's
 *       @capacitor/ios version, and its plugin list equals package.json's.
 *       This is the any-OS half of the drift check; the macOS half is the
 *       post-sync `git status` step in .github/workflows/ios.yml.
 *   (h) none of the files ios/.gitignore marks as cap-sync output is tracked
 *       (Android tracks none of its equivalents either).
 *   (i) .github/workflows/ios.yml stays honest: the WebKit verifier step may
 *       not carry continue-on-error (it was green while exiting 1 for weeks),
 *       and the post-sync drift step must exist between `cap sync ios` and
 *       the Xcode build.
 *
 * No dependencies; paths resolve from this file. `--config <path>` and
 * `--manifest <path>` point it at other copies so the verifier can be
 * verified (flip allowMixedContent in a scratch copy: FAIL naming the key).
 * Same for the iOS checks: `--ios <dir>` (a copy of guidon-app/ios),
 * `--package`, `--lock`, `--tauri`, `--workflow`, and `--tracked <file>` (a
 * newline list of repo-relative tracked paths, used instead of asking git).
 * tools/test-ios-config-lint.mjs plants one defect per check and proves each
 * is caught by name.
 */
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const REPO = path.resolve(APP, "..");
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const CONFIG = argOf("--config") || path.join(APP, "capacitor.config.json");
const MANIFEST = argOf("--manifest") || path.join(APP, "android", "app", "src", "main", "AndroidManifest.xml");
const IOS = argOf("--ios") || path.join(APP, "ios");
const PACKAGE = argOf("--package") || path.join(APP, "package.json");
const LOCK = argOf("--lock") || path.join(APP, "package-lock.json");
const TAURI = argOf("--tauri") || path.join(APP, "src-tauri", "tauri.conf.json");
const WORKFLOW = argOf("--workflow") || path.join(REPO, ".github", "workflows", "ios.yml");
const TRACKED = argOf("--tracked");
const ENGINE_FLOOR = path.join(HERE, "engine-floor.json");

// The exact permission set the shipped manifest declares today. Edit it in
// the same change that adds/removes a <uses-permission>, with the reason.
const ALLOWED_PERMISSIONS = [
  "android.permission.INTERNET",  // WebView loopback today; LAN study rooms (P3/P4) tomorrow
  "android.permission.VIBRATE",   // haptic feedback on drill grading (task #204)
];
// Same discipline as ALLOWED_PERMISSIONS, for <uses-permission ...
// tools:node="remove"> entries: a permission actively suppressed from the
// merged manifest, never a real grant. Edit alongside the manifest change
// that adds/removes one, with the reason.
const ALLOWED_SUPPRESSIONS = [
  // @capacitor/local-notifications' own bundled manifest unconditionally
  // declares this even though notify.js's scheduleForReminder() always sets
  // isExactNotification:false (round 8, Kiosk/Demo Center pitch) - the app
  // never actually needs the Android 12+ "Alarms & reminders" special
  // permission, and shipping it unused is a real Play Console friction
  // point (Google requires written justification for it).
  "android.permission.SCHEDULE_EXACT_ALARM",
];
const FORBIDDEN = [/^android\.permission\.CAMERA$/, /^android\.permission\.RECORD_AUDIO$/,
  /^android\.permission\.ACCESS_FINE_LOCATION$/, /BLUETOOTH/];

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const rel = (p) => path.relative(APP, p).split(path.sep).join("/");

/* ---- iOS tables (checks d-i). Same rule as ALLOWED_PERMISSIONS: exact, and
   edited in the SAME change that adds a plugin or a usage string, with the
   reason. ------------------------------------------------------------------ */
// Every Capacitor plugin in package.json "dependencies" -> the Info.plist
// usage strings its iOS half needs. Read from each plugin's own README
// (2026-09-18): only the biometric plugin needs one ("you must add the
// NSFaceIDUsageDescription key ... If you don't add this key, the system
// won't allow your app to use Face ID"). A plugin missing from this table
// fails check (d) on purpose: adding e.g. a camera plugin must be a decision
// somebody wrote down here, not a line in package.json.
const PLUGIN_USAGE = {
  "@aparajita/capacitor-biometric-auth": ["NSFaceIDUsageDescription"], // Settings > Biometric lock (src/biometric.js)
  "@capacitor/app": [],                 // resume/back-button events only
  "@capacitor/filesystem": [],          // private cache for backup export; no shared-documents keys
  "@capacitor/haptics": [],
  "@capacitor/local-notifications": [], // permission is asked at runtime, no plist string
  "@capacitor/share": [],
  "@capacitor/status-bar": [],
};
// Capacitor packages that are the runtime/toolchain, not plugins.
const NOT_PLUGINS = new Set(["@capacitor/core", "@capacitor/cli", "@capacitor/android", "@capacitor/ios"]);
// Named so the failure says WHY, not just "not in the allow-list". GUIDON has
// no camera, microphone, location, Bluetooth, contacts, photo or tracking use.
const FORBIDDEN_USAGE = [/^NSCamera/, /^NSMicrophone/, /^NSLocation/, /^NSBluetooth/, /^NSUserTracking/,
  /^NSContacts/, /^NSPhotoLibrary/, /^NSSpeechRecognition/, /^NSMotion/, /^NSLocalNetwork/];
// The generated paths ios/.gitignore lists (relative to the ios project root).
const IOS_GENERATED = ["App/App/capacitor.config.json", "App/App/config.xml", "capacitor-cordova-ios-plugins/", "App/App/public/"];

/* Top-level <key> -> value of an XML property list. Not a general plist
   parser: it walks tags with a depth counter so a key nested inside
   UIApplicationSceneManifest is never mistaken for a top-level one, and it
   keeps only what these checks read (string text; everything else by tag). */
function plistTopLevel(xml) {
  const live = xml.replace(/<!--[\s\S]*?-->/g, "");
  const start = live.indexOf("<dict>", live.indexOf("<plist"));
  if (start < 0) return null;
  const re = /<(\/?)(key|string|dict|array|integer|real|date|data)>|<(true|false|dict|array|string)\s*\/>|([^<]+)/g;
  re.lastIndex = start;
  const out = new Map();
  let depth = 0, pendingKey = null, open = null, text = "", m;
  while ((m = re.exec(live))) {
    if (m[4] != null) { if (open) text += m[4]; continue; }
    if (m[3]) { // self-closing: <true/>, <false/>, <dict/> ...
      if (depth === 1 && pendingKey != null) { out.set(pendingKey, { type: m[3], value: "" }); pendingKey = null; }
      continue;
    }
    const closing = m[1] === "/", tag = m[2];
    if (tag === "dict" || tag === "array") {
      if (!closing) {
        if (depth === 1 && pendingKey != null) { out.set(pendingKey, { type: tag, value: "" }); pendingKey = null; }
        depth++;
      } else { depth--; if (depth === 0) break; }
      continue;
    }
    if (!closing) { open = tag; text = ""; continue; }
    if (depth === 1) {
      if (tag === "key") pendingKey = text.trim();
      else if (pendingKey != null) { out.set(pendingKey, { type: tag, value: text.trim() }); pendingKey = null; }
    }
    open = null;
  }
  return out;
}
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
// "16.2" vs "16.10": compare as number lists, never as strings or floats.
const cmpVersion = (a, b) => {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
};
const readOr = async (p) => { try { return await readFile(p, "utf-8"); } catch (e) { return null; } };

console.log("lint-capacitor-config: the Android and iOS shells may not widen the network promise\n");

/* (a) capacitor.config.json ------------------------------------------- */
{
  let cfg = null;
  try { cfg = JSON.parse(await readFile(CONFIG, "utf-8")); }
  catch (e) { bad(`(a) ${rel(CONFIG)} unreadable: ${e.message}`); }
  if (cfg) {
    const get = (p) => p.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), cfg);
    const WANT = [["server.androidScheme", "https"], ["android.allowMixedContent", false], ["plugins.CapacitorHttp.enabled", false]];
    for (const [key, want] of WANT) {
      const got = get(key);
      got === want ? ok(`(a) ${rel(CONFIG)} ${key} === ${JSON.stringify(want)}`)
                   : bad(`(a) ${rel(CONFIG)} ${key} is ${JSON.stringify(got)}, must be ${JSON.stringify(want)}`);
    }
  }
}

/* (b)+(c) AndroidManifest.xml ----------------------------------------- */
{
  let xml = null;
  try { xml = await readFile(MANIFEST, "utf-8"); }
  catch (e) { bad(`(b) ${rel(MANIFEST)} unreadable: ${e.message}`); }
  if (xml != null) {
    // Comments are not declarations.
    const live = xml.replace(/<!--[\s\S]*?-->/g, "");
    const declared = [];
    const suppressed = []; // tools:node="remove" - actively narrows the merged
    // manifest, the opposite of "widening the network/permission promise"
    // this whole lint exists to catch. A library's own bundled manifest can
    // pull a permission in transitively (e.g. @capacitor/local-notifications
    // always declares SCHEDULE_EXACT_ALARM even when isExactNotification is
    // never set - see notify.js) with nothing in THIS file to show for it;
    // this project's own convention for suppressing that (round 8,
    // src/index.html's Kiosk/Demo Center pitch) is a <uses-permission> entry
    // carrying tools:node="remove", which must not be mistaken for a grant.
    const re = /<uses-permission(?:-sdk-23)?\b([^>]*?)android:name\s*=\s*"([^"]+)"[^>]*>/g;
    let m;
    while ((m = re.exec(live))) {
      const [, attrsBefore, name] = m;
      const fullTag = m[0];
      if (/tools:node\s*=\s*"remove"/.test(attrsBefore) || /tools:node\s*=\s*"remove"/.test(fullTag)) suppressed.push(name);
      else declared.push(name);
    }
    const internet = declared.filter((p) => p === "android.permission.INTERNET").length;
    internet === 1 ? ok(`(b) ${rel(MANIFEST)} declares android.permission.INTERNET exactly once`)
                   : bad(`(b) ${rel(MANIFEST)} declares android.permission.INTERNET ${internet} time(s), must be exactly 1`);
    const extra = declared.filter((p) => !ALLOWED_PERMISSIONS.includes(p));
    const missing = ALLOWED_PERMISSIONS.filter((p) => !declared.includes(p));
    const forbidden = declared.filter((p) => FORBIDDEN.some((f) => f.test(p)));
    if (forbidden.length) bad(`(c) ${rel(MANIFEST)} declares forbidden permission(s): ${forbidden.join(", ")}`);
    if (extra.length) bad(`(c) ${rel(MANIFEST)} declares permission(s) not in this lint's allow-list: ${extra.join(", ")} - add them here, with the reason, in the same change`);
    if (missing.length) bad(`(c) ${rel(MANIFEST)} no longer declares: ${missing.join(", ")} - remove them from this lint's allow-list in the same change`);
    if (!forbidden.length && !extra.length && !missing.length)
      ok(`(c) ${rel(MANIFEST)} permission set is exactly [${declared.join(", ")}]; no CAMERA / RECORD_AUDIO / ACCESS_FINE_LOCATION / BLUETOOTH*`);

    // Suppressions get the same exact-allow-list discipline as real grants -
    // an unexpected tools:node="remove" entry is just as worth a second look
    // as an unexpected declaration would be, even though it narrows rather
    // than widens the manifest.
    const unexpectedSuppressions = suppressed.filter((p) => !ALLOWED_SUPPRESSIONS.includes(p));
    if (unexpectedSuppressions.length) bad(`(c) ${rel(MANIFEST)} suppresses (tools:node="remove") permission(s) not in this lint's allow-list: ${unexpectedSuppressions.join(", ")} - add them here, with the reason, in the same change`);
    else if (suppressed.length) ok(`(c) ${rel(MANIFEST)} correctly suppresses [${suppressed.join(", ")}] pulled in transitively by a Capacitor plugin - not a real grant`);
  }
}

/* ===================== iOS shell (checks d-i) ========================== */
const INFO_PLIST = path.join(IOS, "App", "App", "Info.plist");
const PBXPROJ = path.join(IOS, "App", "App.xcodeproj", "project.pbxproj");
const SPM = path.join(IOS, "App", "CapApp-SPM", "Package.swift");

let pkg = null, appId = null;
try { pkg = JSON.parse(await readFile(PACKAGE, "utf-8")); } catch (e) { bad(`(d) ${rel(PACKAGE)} unreadable: ${e.message}`); }
try { appId = JSON.parse(await readFile(CONFIG, "utf-8")).appId || null; } catch (e) { /* (a) already reported it */ }
// The plugins this build bundles: every Capacitor-scoped dependency that is
// not the runtime itself. package.json is the source; the ios copy of
// capacitor.config.json (packageClassList) is generated and untracked.
const plugins = pkg ? Object.keys(pkg.dependencies || {}).filter((d) => /^@capacitor\/|capacitor/i.test(d) && !NOT_PLUGINS.has(d)).sort() : [];

/* (d)+(e) Info.plist --------------------------------------------------- */
{
  const xml = await readOr(INFO_PLIST);
  const plist = xml == null ? null : plistTopLevel(xml);
  if (xml == null) bad(`(d) ${rel(INFO_PLIST)} is missing - the iOS project must be committed`);
  else if (!plist) bad(`(d) ${rel(INFO_PLIST)} has no top-level <dict> - not a property list this lint can read`);
  else if (pkg) {
    const unknown = plugins.filter((p) => !(p in PLUGIN_USAGE));
    if (unknown.length) bad(`(d) package.json bundles Capacitor plugin(s) this lint has no entry for: ${unknown.join(", ")} - add each to PLUGIN_USAGE with the Info.plist usage strings its README requires, in the same change`);
    const required = new Map(); // key -> plugin that needs it
    for (const p of plugins) for (const k of PLUGIN_USAGE[p] || []) required.set(k, p);
    const present = [...plist.keys()].filter((k) => /^NS.*UsageDescription$/.test(k));
    let clean = !unknown.length;
    for (const [key, plugin] of required) {
      const v = plist.get(key);
      const textValue = v && v.type === "string" ? unxml(v.value) : "";
      if (!v) { clean = false; bad(`(d) ${rel(INFO_PLIST)} has no ${key}, but ${plugin} is bundled - iOS refuses the feature (and App Review rejects the build) without it. Add a plain-language sentence saying what GUIDON uses it for`); }
      else if (textValue.length < 20 || /\$\(|TODO|FIXME|lorem/i.test(textValue)) { clean = false; bad(`(d) ${rel(INFO_PLIST)} ${key} is ${JSON.stringify(textValue)} - it is shown to the Soldier in the system prompt, so it must be a real sentence (20+ characters, no placeholder)`); }
    }
    for (const key of present) {
      if (required.has(key)) continue;
      clean = false;
      FORBIDDEN_USAGE.some((f) => f.test(key))
        ? bad(`(d) ${rel(INFO_PLIST)} declares ${key} - GUIDON has no camera, microphone, location, Bluetooth, contacts, photo, local-network or tracking use; a usage string is the first step of asking for one`)
        : bad(`(d) ${rel(INFO_PLIST)} declares ${key}, which no bundled plugin in this lint's PLUGIN_USAGE table needs - add the plugin and the reason there in the same change, or remove the key`);
    }
    if (clean) ok(`(d) ${rel(INFO_PLIST)} usage strings are exactly [${[...required.keys()].join(", ")}] for ${plugins.length} bundled plugin(s); none empty, none extra`);

    plist.has("NSAppTransportSecurity")
      ? bad(`(e) ${rel(INFO_PLIST)} declares NSAppTransportSecurity - an App Transport Security exception is how an iOS build starts talking plaintext; the app loads itself from the bundle and needs none`)
      : ok(`(e) ${rel(INFO_PLIST)} has no NSAppTransportSecurity key (no ATS exceptions)`);
  }
}

/* (f) project.pbxproj -------------------------------------------------- */
{
  const pbx = await readOr(PBXPROJ);
  if (pbx == null) bad(`(f) ${rel(PBXPROJ)} is missing`);
  else {
    const all = (re) => [...pbx.matchAll(re)].map((m) => m[1].trim().replace(/^"|"$/g, ""));
    const ids = all(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g);
    const wrongIds = ids.filter((id) => id !== appId);
    if (!ids.length) bad(`(f) ${rel(PBXPROJ)} sets no PRODUCT_BUNDLE_IDENTIFIER`);
    else if (wrongIds.length) bad(`(f) ${rel(PBXPROJ)} PRODUCT_BUNDLE_IDENTIFIER ${[...new Set(wrongIds)].join(", ")} does not match capacitor.config.json appId ${JSON.stringify(appId)} - the Simulator gate launches by that id, and a different id is a different app to iOS (separate data, separate install)`);
    else ok(`(f) ${rel(PBXPROJ)} PRODUCT_BUNDLE_IDENTIFIER is ${appId} in all ${ids.length} build configuration(s), matching capacitor.config.json`);

    let tauriId = null;
    try { tauriId = JSON.parse(await readFile(TAURI, "utf-8")).identifier || null; } catch (e) { bad(`(f) ${rel(TAURI)} unreadable: ${e.message}`); }
    if (tauriId != null) tauriId === appId ? ok(`(f) ${rel(TAURI)} identifier is ${appId} too - one app id on every shell`)
      : bad(`(f) ${rel(TAURI)} identifier is ${JSON.stringify(tauriId)} but capacitor.config.json appId is ${JSON.stringify(appId)} - the macOS and iOS builds must be the same app to Apple`);

    const targets = all(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([^;]+);/g);
    let floor = null;
    try { floor = String(JSON.parse(await readFile(ENGINE_FLOOR, "utf-8")).webkit); } catch (e) { bad(`(f) tools/engine-floor.json unreadable: ${e.message}`); }
    const distinct = [...new Set(targets)];
    if (!targets.length) bad(`(f) ${rel(PBXPROJ)} sets no IPHONEOS_DEPLOYMENT_TARGET`);
    else if (distinct.length > 1) bad(`(f) ${rel(PBXPROJ)} IPHONEOS_DEPLOYMENT_TARGET disagrees between build configurations: ${distinct.join(" vs ")}`);
    else if (floor && cmpVersion(distinct[0], floor) < 0) bad(`(f) ${rel(PBXPROJ)} IPHONEOS_DEPLOYMENT_TARGET ${distinct[0]} is below the WebKit engine floor ${floor} (tools/engine-floor.json) - the app would install on an iOS whose web view cannot render it`);
    else if (floor) ok(`(f) ${rel(PBXPROJ)} IPHONEOS_DEPLOYMENT_TARGET is ${distinct[0]} everywhere, not below the WebKit engine floor ${floor}`);

    const plistFiles = [...new Set(all(/INFOPLIST_FILE\s*=\s*([^;]+);/g))];
    const generated = /GENERATE_INFOPLIST_FILE\s*=\s*YES/.test(pbx);
    const keyOverrides = [...new Set(all(/(INFOPLIST_KEY_NS[A-Za-z]*)\s*=/g))];
    if (plistFiles.length !== 1 || plistFiles[0] !== "App/Info.plist") bad(`(f) ${rel(PBXPROJ)} INFOPLIST_FILE is ${JSON.stringify(plistFiles)}, must be exactly "App/Info.plist" - checks (d)/(e) read that file and must be reading the one Xcode uses`);
    else if (generated || keyOverrides.length) bad(`(f) ${rel(PBXPROJ)} ${generated ? "sets GENERATE_INFOPLIST_FILE = YES" : "sets " + keyOverrides.join(", ")} - privacy keys injected from build settings bypass checks (d)/(e); keep them in App/Info.plist`);
    else ok(`(f) ${rel(PBXPROJ)} uses App/Info.plist as written (no generated plist, no INFOPLIST_KEY_NS* override)`);
  }
}

/* (g) CapApp-SPM/Package.swift ----------------------------------------- */
{
  const swift = await readOr(SPM);
  let lockIos = null;
  try { lockIos = (JSON.parse(await readFile(LOCK, "utf-8")).packages["node_modules/@capacitor/ios"] || {}).version || null; }
  catch (e) { bad(`(g) ${rel(LOCK)} unreadable: ${e.message}`); }
  if (swift == null) bad(`(g) ${rel(SPM)} is missing - it is the committed half of \`cap sync ios\` (Android's twin: capacitor.settings.gradle)`);
  else {
    const pin = (swift.match(/capacitor-swift-pm\.git"\s*,\s*exact:\s*"([^"]+)"/) || [])[1] || null;
    if (!pin) bad(`(g) ${rel(SPM)} has no exact capacitor-swift-pm pin`);
    else if (lockIos && pin !== lockIos) bad(`(g) ${rel(SPM)} pins capacitor-swift-pm ${pin} but package-lock.json installs @capacitor/ios ${lockIos} - the committed file is stale; run \`npm run ios:sync\` and commit ios/App/CapApp-SPM/Package.swift`);
    else if (lockIos) ok(`(g) ${rel(SPM)} pins capacitor-swift-pm ${pin}, the @capacitor/ios version in package-lock.json`);
    const listed = [...swift.matchAll(/path:\s*"(?:\.\.\/)+node_modules\/([^"]+)"/g)].map((m) => m[1]).sort();
    const missing = plugins.filter((p) => !listed.includes(p)), extra = listed.filter((p) => !plugins.includes(p));
    if (missing.length || extra.length) bad(`(g) ${rel(SPM)} plugin list differs from package.json${missing.length ? " - not linked: " + missing.join(", ") : ""}${extra.length ? " - linked but not a dependency: " + extra.join(", ") : ""}; run \`npm run ios:sync\` and commit the result`);
    else if (pkg) ok(`(g) ${rel(SPM)} links exactly package.json's ${plugins.length} Capacitor plugin(s)`);
  }
}

/* (h) cap-sync output stays untracked ---------------------------------- */
{
  let tracked = null, why = "";
  if (TRACKED) { const t = await readOr(TRACKED); tracked = t == null ? null : t.split(/\r?\n/).filter(Boolean); if (t == null) why = `${TRACKED} unreadable`; }
  else {
    try { tracked = execFileSync("git", ["-C", IOS, "ls-files", "--full-name", "--", "."], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).filter(Boolean); }
    catch (e) { why = "git is not available here"; }
  }
  if (!tracked) console.log(`  INFO  (h) skipped: ${why} (CI runs it from a real checkout)`);
  else {
    const hit = tracked.filter((f) => IOS_GENERATED.some((g) => { const at = f.indexOf("ios/" + g); return at >= 0 && (at === 0 || f[at - 1] === "/"); }));
    hit.length ? bad(`(h) cap-sync output is tracked: ${hit.join(", ")} - ios/.gitignore ignores these because \`npx cap sync ios\` rewrites them on every run; \`git rm --cached\` them (Android tracks none of its equivalents)`)
               : ok(`(h) none of the cap-sync outputs ios/.gitignore lists is tracked (${tracked.length} tracked iOS file(s) checked)`);
  }
}

/* (i) .github/workflows/ios.yml stays honest ---------------------------- */
{
  const yml = await readOr(WORKFLOW);
  if (yml == null) bad(`(i) ${rel(WORKFLOW)} is missing`);
  else {
    // One entry per step: the text from a "      - " list item to the next.
    const steps = yml.replace(/\r\n/g, "\n").split(/\n(?=\s{6}- )/).slice(1).map((s) => s.replace(/^\s*#.*$/gm, ""));
    const verify = steps.filter((s) => /run:[\s\S]*ios:verify/.test(s));
    const lenient = verify.filter((s) => /continue-on-error:\s*true/.test(s));
    const jobLenient = /\n\s{4}continue-on-error:\s*true/.test(yml.replace(/\r\n/g, "\n"));
    if (!verify.length) bad(`(i) ${rel(WORKFLOW)} no longer runs the WebKit verifier (npm run ios:verify...) at all`);
    else if (lenient.length || jobLenient) bad(`(i) ${rel(WORKFLOW)} runs the WebKit verifier with continue-on-error: true - the job then reports green while the verifier exits 1. Known defects belong in tools/ios-webkit-baseline.json, not behind a switch that also hides new ones`);
    else ok(`(i) ${rel(WORKFLOW)} WebKit verifier step can fail the job (no continue-on-error)`);

    const iSync = steps.findIndex((s) => /run:[\s\S]*cap sync ios/.test(s));
    const iDrift = steps.findIndex((s) => /run:[\s\S]*git status --porcelain[^\n]* ios\b/.test(s));
    const iBuild = steps.findIndex((s) => /run:[\s\S]*xcodebuild[\s\S]*-scheme\s+App\b/.test(s));
    if (iSync < 0) bad(`(i) ${rel(WORKFLOW)} has no \`npx cap sync ios\` step`);
    else if (iDrift < 0) bad(`(i) ${rel(WORKFLOW)} has no post-sync drift step (\`git status --porcelain -- ios\`) - a stale committed CapApp-SPM/Package.swift would never be noticed, because CI builds the regenerated copy`);
    else if (iDrift < iSync || (iBuild >= 0 && iDrift > iBuild)) bad(`(i) ${rel(WORKFLOW)} drift step must run after \`cap sync ios\` and before the Xcode build (Xcode writes its own files into ios/)`);
    else ok(`(i) ${rel(WORKFLOW)} checks for post-sync drift between \`cap sync ios\` and the Xcode build`);
  }
}

console.log("\n" + (fails ? `LINT-CAPACITOR-CONFIG: ${fails} FAILURE(S)` : "LINT-CAPACITOR-CONFIG: all passed"));
process.exit(fails ? 1 : 0);
