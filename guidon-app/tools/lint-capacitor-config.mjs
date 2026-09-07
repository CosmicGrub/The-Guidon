/**
 * Capacitor / Android config invariant for the "No server, ever" promise
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
 * No dependencies; paths resolve from this file. `--config <path>` and
 * `--manifest <path>` point it at other copies so the verifier can be
 * verified (flip allowMixedContent in a scratch copy: FAIL naming the key).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const CONFIG = argOf("--config") || path.join(APP, "capacitor.config.json");
const MANIFEST = argOf("--manifest") || path.join(APP, "android", "app", "src", "main", "AndroidManifest.xml");

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

console.log("lint-capacitor-config: the Android shell may not widen the network promise\n");

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

console.log("\n" + (fails ? `LINT-CAPACITOR-CONFIG: ${fails} FAILURE(S)` : "LINT-CAPACITOR-CONFIG: all passed"));
process.exit(fails ? 1 : 0);
