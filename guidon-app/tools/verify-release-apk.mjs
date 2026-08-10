/**
 * Verifies an installed release APK actually contains the web assets you
 * think it does — turns a manual workaround into a real script.
 *
 * The workaround: v1.4.11 and v1.4.13 were each hand-verified on two real
 * devices (a Galaxy Z Fold 5 and a Tab S9 FE) by pulling the installed
 * `base.apk`, unzipping it, and sha256-comparing its bundled
 * `assets/public/index.html`/`sw.js` against a fresh `web/` build — done by
 * hand with adb + unzip + sha256sum, one device at a time.
 *
 * Why this matters enough to script: `gradlew assembleRelease` run without a
 * prior `cap sync android` (or `npm run android:sync`, which chains both)
 * silently packages STALE `android/app/src/main/assets/public/` content —
 * the build succeeds, the install succeeds, and the app just runs old code
 * with no error anywhere in the pipeline. This exact mistake happened once
 * already this project. Release builds also disable WebView remote
 * debugging (see test-android.mjs's CDP approach), so you can't inspect the
 * running page to catch it — comparing the actual installed bytes is the
 * only check that works.
 *
 * No new dependency: an APK is a standard ZIP, and the two entries this
 * needs are DEFLATE or STORED, both of which Node's built-in zlib already
 * decodes. A hand-rolled central-directory reader is ~40 lines and this
 * script runs a handful of times per release — not worth a package.
 *
 * Usage:
 *   node tools/verify-release-apk.mjs              # every connected device
 *   node tools/verify-release-apk.mjs <serial>      # one device
 *   node tools/verify-release-apk.mjs <s1> <s2>     # specific devices
 *
 * Requires: adb on PATH (or ADB env var pointing at it), app.guidon.trainer
 * installed on at least one connected device/emulator, and a `web/` build
 * on disk to compare against — run `npm run build` first if in doubt; this
 * script does NOT rebuild for you, on purpose, so it verifies exactly what
 * is on disk right now rather than silently regenerating a new baseline.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADB = process.env.ADB || "adb";
const PKG = "app.guidon.trainer";
// Maps the path inside the APK to the local file it should match byte-for-byte.
const CHECKS = [
  { inApk: "assets/public/index.html", local: "web/index.html" },
  { inApk: "assets/public/sw.js", local: "web/sw.js" },
];

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const skip = (m) => console.log("  SKIP  " + m);

const adb = (...a) => execFileSync(ADB, a, { encoding: "utf8" });
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ---- minimal ZIP reader: just enough to pull named entries out of an APK ----
function readZipEntries(apkBuf, wantedPaths) {
  const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50, LOC_SIG = 0x04034b50;
  // The EOCD record sits at the end, but may be followed by a variable-length
  // comment field — scan backward for the signature instead of assuming a
  // fixed offset. 65535 is the max possible comment length (a 2-byte field).
  let eocd = -1;
  const floor = Math.max(0, apkBuf.length - 22 - 65535);
  for (let i = apkBuf.length - 22; i >= floor; i--) {
    if (apkBuf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("not a valid zip/apk — no End Of Central Directory record found");

  const cdEntries = apkBuf.readUInt16LE(eocd + 10);
  const cdOffset = apkBuf.readUInt32LE(eocd + 16);

  const found = new Map();
  let p = cdOffset;
  for (let i = 0; i < cdEntries && found.size < wantedPaths.length; i++) {
    if (apkBuf.readUInt32LE(p) !== CEN_SIG) throw new Error("central directory record corrupt at entry " + i);
    const method = apkBuf.readUInt16LE(p + 10);
    const compSize = apkBuf.readUInt32LE(p + 20);
    const nameLen = apkBuf.readUInt16LE(p + 28);
    const extraLen = apkBuf.readUInt16LE(p + 30);
    const commentLen = apkBuf.readUInt16LE(p + 32);
    const localOffset = apkBuf.readUInt32LE(p + 42);
    const name = apkBuf.toString("utf8", p + 46, p + 46 + nameLen);
    if (wantedPaths.includes(name)) {
      // The local file header repeats name/extra fields, sometimes at a
      // different length than the central directory's copy — read it to
      // find the real data start rather than trusting the CD's lengths.
      if (apkBuf.readUInt32LE(localOffset) !== LOC_SIG) throw new Error("local file header corrupt for " + name);
      const locNameLen = apkBuf.readUInt16LE(localOffset + 26);
      const locExtraLen = apkBuf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + locNameLen + locExtraLen;
      const raw = apkBuf.subarray(dataStart, dataStart + compSize);
      found.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return found;
}

function listDevices() {
  const out = adb("devices");
  return out.split("\n").slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);
}

// `pm path` on a device that simply doesn't have the package installed
// exits non-zero with empty output — the overwhelmingly common reason this
// fails, and an expected, unremarkable one when this script runs against
// every connected device rather than one you already know has GUIDON on
// it. Treated as "not applicable to this device", not a verification
// failure — a real adb-level problem (offline, unauthorized) would already
// have been filtered out by listDevices()'s "device" state check before
// this ever runs, for the auto-detect path; for an explicit serial passed
// on the command line, that same failure mode surfaces here as a skip too,
// which is the right call — this script verifies APK contents, not adb
// connectivity.
function apkPathOnDevice(serial) {
  let raw;
  try {
    raw = adb("-s", serial, "shell", "pm", "path", PKG);
  } catch (e) {
    return null;
  }
  const lines = raw.trim().split("\n").map((l) => l.replace(/^package:/, "").trim()).filter(Boolean);
  if (!lines.length) return null;
  return lines.find((l) => l.endsWith("base.apk")) || lines[0];
}

function verifyDevice(serial, tmpDir) {
  console.log(`\nDevice ${serial}:`);
  const remotePath = apkPathOnDevice(serial);
  if (!remotePath) {
    skip(`${serial}: ${PKG} is not installed on this device`);
    return "skipped";
  }

  const localApk = join(tmpDir, `${serial.replace(/[^a-z0-9]/gi, "_")}-base.apk`);
  try {
    adb("-s", serial, "pull", remotePath, localApk);
  } catch (e) {
    bad(`${serial}: adb pull failed (${e.message.split("\n")[0]})`);
    return "verified";
  }

  let apkBuf;
  try {
    apkBuf = readFileSync(localApk);
  } finally {
    try { rmSync(localApk, { force: true }); } catch (e) { /* best-effort cleanup */ }
  }

  let entries;
  try {
    entries = readZipEntries(apkBuf, CHECKS.map((c) => c.inApk));
  } catch (e) {
    bad(`${serial}: failed to read APK as a zip (${e.message})`);
    return "verified";
  }

  for (const { inApk, local } of CHECKS) {
    if (!existsSync(local)) {
      bad(`${local} not found on disk — run "npm run build" first`);
      continue;
    }
    const installed = entries.get(inApk);
    if (!installed) {
      bad(`${serial}: ${inApk} not found inside the installed APK`);
      continue;
    }
    const installedHash = sha256(installed);
    const localHash = sha256(readFileSync(local));
    if (installedHash === localHash) {
      ok(`${serial}: ${inApk} matches ${local} (${installedHash.slice(0, 12)}…)`);
    } else {
      bad(`${serial}: ${inApk} does NOT match ${local} — installed ${installedHash.slice(0, 12)}… vs local ${localHash.slice(0, 12)}… (stale install — run "npm run android:sync" then reinstall)`);
    }
  }
  return "verified";
}

// ---- main ----
try {
  adb("version");
} catch (e) {
  console.error(`adb not found (looked for "${ADB}"). Set the ADB env var to its full path, or put platform-tools on PATH.`);
  process.exit(2);
}

const requested = process.argv.slice(2);
const targets = requested.length ? requested : listDevices();

if (!targets.length) {
  console.error("No connected devices found (adb devices returned none in \"device\" state).");
  process.exit(2);
}

const tmpDir = mkdtempSync(join(tmpdir(), "guidon-apk-verify-"));
let verifiedCount = 0, skippedCount = 0;
try {
  for (const serial of targets) {
    const result = verifyDevice(serial, tmpDir);
    if (result === "verified") verifiedCount++;
    else if (result === "skipped") skippedCount++;
  }
} finally {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best-effort cleanup */ }
}

console.log("");
if (skippedCount) console.log(`${skippedCount} device(s) skipped (${PKG} not installed there).`);
if (verifiedCount === 0) {
  console.log(`No device had ${PKG} installed — nothing to verify. Install it, then run this again.`);
  process.exit(fails === 0 ? 0 : 1);
}
console.log(fails === 0
  ? `ALL PASS — ${verifiedCount} device(s) checked, all match the current web/ build`
  : `${fails} FAILURE(S) across ${verifiedCount} device(s) checked`);
process.exit(fails === 0 ? 0 : 1);
