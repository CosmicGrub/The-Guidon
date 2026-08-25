/**
 * Verifies the real, on-device-generated Baseline Profile (Roadmap Tier 7)
 * actually made it into a release build — same spirit as
 * verify-release-apk.mjs (real bytes in, real bytes out), but checking the
 * local build output rather than an installed device APK, since ART's
 * profile bundling happens at build time (assembleRelease/bundleRelease),
 * not install time.
 *
 * Checks two independent things:
 *   1. The checked-in SOURCE profile (produced by
 *      `:app:copyReleaseBaselineProfileIntoSrc`, part of the
 *      androidx.baselineprofile plugin's generateBaselineProfile task chain
 *      — see android/baselineprofile/) exists and is non-trivial: a real
 *      profile has hundreds of "class"/method-signature lines, not an
 *      empty stub.
 *   2. The built release APK genuinely bundles the COMPILED, binary form of
 *      it. Deliberately does not hardcode the in-APK path (AGP has moved
 *      this between android.tools/dex-format releases before) — it scans
 *      the APK's real zip central directory for any entry whose filename is
 *      literally "baseline.prof" and requires it to be non-trivially sized.
 *
 * No new dependency — reuses the same hand-rolled zip central-directory
 * reader verify-release-apk.mjs already proved out (DEFLATE/STORED via
 * Node's built-in zlib).
 *
 * Usage:
 *   node tools/verify-baseline-profile.mjs
 *   node tools/verify-baseline-profile.mjs path/to/app-release.apk
 *
 * Requires a release APK already built (`npm run android:release` or at
 * least `node tools/android-gradle.mjs assembleRelease` from guidon-app/)
 * — this script does NOT build one for you, on purpose, matching
 * verify-release-apk.mjs's own "verify exactly what's on disk" contract.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// ---- minimal ZIP reader (identical approach to verify-release-apk.mjs) ----
function readZipCentralDirectory(buf) {
  const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50;
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("not a valid zip/apk — no End Of Central Directory record found");

  const cdEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error("central directory record corrupt at entry " + i);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntryData(buf, entry) {
  const LOC_SIG = 0x04034b50;
  if (buf.readUInt32LE(entry.localOffset) !== LOC_SIG) throw new Error("local file header corrupt for " + entry.name);
  const locNameLen = buf.readUInt16LE(entry.localOffset + 26);
  const locExtraLen = buf.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + locNameLen + locExtraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compSize);
  return entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
}

// ---- 1) checked-in source profile ----
function findCheckedInProfile() {
  // Real location the androidx.baselineprofile plugin's
  // copyReleaseBaselineProfileIntoSrc task writes to for this project
  // (no product flavors — just the "main" source set). Walked rather than
  // hardcoded-deep so a future AGP moving the exact subpath doesn't silently
  // make this script blind.
  const base = join(ROOT, "android", "app", "src");
  const found = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name === "baseline-prof.txt") found.push(full);
    }
  };
  walk(base);
  return found;
}

console.log("[1] Checked-in source profile (android/app/src/**/baseline-prof.txt)");
const srcProfiles = findCheckedInProfile();
if (!srcProfiles.length) {
  bad("no baseline-prof.txt found under android/app/src — run the real generateBaselineProfile task on a connected device first");
} else {
  for (const p of srcProfiles) {
    const text = readFileSync(p, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const rel = p.slice(ROOT.length);
    if (lines.length < 20) {
      bad(`${rel}: only ${lines.length} non-blank line(s) — too small to be a real generated profile`);
    } else {
      ok(`${rel}: ${lines.length} entries`);
      const guidonLines = lines.filter((l) => l.includes("app/guidon/trainer") || l.includes("app.guidon.trainer"));
      if (guidonLines.length) ok(`  ${guidonLines.length} entries reference app.guidon.trainer's own classes`);
      console.log("  sample:");
      for (const l of lines.slice(0, 3)) console.log("    " + l.trim());
    }
  }
}

// ---- 2) compiled binary profile inside the release APK ----
console.log("\n[2] Compiled baseline.prof inside the built release APK");
const explicitApk = process.argv[2];
const defaultApk = join(ROOT, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
const apkPath = explicitApk || defaultApk;

if (!existsSync(apkPath)) {
  bad(`no release APK at ${apkPath.slice(ROOT.length)} — run "npm run android:release" (or assembleRelease) first`);
} else {
  const buf = readFileSync(apkPath);
  let entries;
  try {
    entries = readZipCentralDirectory(buf);
  } catch (e) {
    entries = null;
    bad(`failed to read ${apkPath} as a zip (${e.message})`);
  }
  if (entries) {
    const profEntries = entries.filter((e) => e.name.endsWith("baseline.prof"));
    if (!profEntries.length) {
      bad(`no "baseline.prof" entry found anywhere inside ${apkPath.slice(ROOT.length)} — profile was not bundled`);
    } else {
      for (const e of profEntries) {
        const data = readZipEntryData(buf, e);
        if (data.length < 50) {
          bad(`${e.name}: only ${data.length} bytes — too small to be a real compiled profile`);
        } else {
          ok(`${e.name}: ${data.length} bytes (compressed ${e.compSize})`);
        }
      }
    }
  }
}

console.log("");
console.log(fails === 0 ? "ALL PASS — real baseline profile generated, checked in, and bundled" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
