#!/usr/bin/env node
/**
 * Adversarial suite against RoomTlsPlugin's native TLS trust-manager logic
 * (room-tls-and-discovery-pitch.md Section 3, the paragraph beginning
 * "Explicitly NOT covered by the fuzzer above..."): tools/fuzz-room-validate.mjs
 * only reaches src/app-modules/room-schema.js's / src-tauri/src/room.rs's
 * validate() - decoded APPLICATION frames. It has zero reach into
 * android/app/src/main/java/app/guidon/trainer/RoomTlsPlugin.kt's
 * X509TrustManager pin-check, which is Kotlin/JVM-only and runs entirely
 * below the application-frame layer. This is that suite's own harness.
 *
 * THIS FILE is a thin Node wrapper, same shape as tools/fuzz-room-validate.mjs
 * spawning src-tauri's fuzz_validate binary: it locates a JDK 21+ and the
 * Kotlin compiler jars already resolved in this project's own Gradle cache
 * (never a new Gradle/npm dependency), compiles the REAL, unmodified
 * RoomTlsPlugin.kt together with tools/tls-adversarial/'s JVM-only stubs and
 * adversarial cases in ONE kotlinc invocation, and runs the result as a
 * plain `java` process - no Android Gradle plugin, no device, no emulator.
 * All of the actual test logic (cert generation via keytool, the eight
 * adversarial cases, the PASS/FAIL/KNOWN/INFO reporting) lives in
 * tools/tls-adversarial/Harness.kt; this file just gets it built and run,
 * and relays its own already-conventional output.
 *
 * Environment-gated like this project's other host-dependent suites
 * (test:room-tauri skips when its exe is missing, test:room-xeng skips
 * where WebKit isn't installed): if no JDK 21+ or the Gradle cache doesn't
 * have the Kotlin compiler jars yet, this SKIPS ALOUD (prints why, exits 0)
 * rather than failing CI runners that never had a reason to carry an
 * Android/Kotlin toolchain. Populate the cache once with
 * `android/gradlew.bat -p android help` (or any real Gradle invocation) on
 * a machine that has a JDK 21+, then this suite runs for real there.
 *
 * Usage: node tools/test-tls-adversarial.mjs   (exit code = FAIL count)
 * Override JDK discovery with GUIDON_TLS_TEST_JAVA_HOME (checked first) or
 * the same GUIDON_ANDROID_JAVA_HOME / JAVA_HOME / JAVA_HOME_21_X64 chain
 * tools/android-gradle.mjs already uses. Override the Gradle cache location
 * with GRADLE_USER_HOME (defaults to ~/.gradle, Gradle's own default).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const REQUIRED_MAJOR = 21;

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);

console.log("test-tls-adversarial: RoomTlsPlugin native trust-manager suite (JVM-only, no device/emulator)\n");

/* ------------------------------------------------------------- JDK 21+ --
   Same candidate chain as tools/android-gradle.mjs (this suite needs the
   exact same "a real JDK 21+, with its bundled keytool" requirement as the
   real Android Gradle build does), plus a GUIDON_TLS_TEST_JAVA_HOME
   override of its own and a scan of ~/.jdk21/* (this project's own
   documented standalone-JDK21 install location, so a machine already set
   up for the Android toolchain needs no extra configuration here). */
function parseMajor(versionOutput) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(versionOutput || "");
  if (!m) return null;
  const first = parseInt(m[1], 10);
  return first === 1 ? parseInt(m[2], 10) : first;
}
function javaMajorVersion(javaBin) {
  const res = spawnSync(javaBin, ["-version"], { encoding: "utf8" });
  return parseMajor((res.stderr || "") + (res.stdout || ""));
}
function candidateJavaHomes() {
  const list = [];
  if (process.env.GUIDON_TLS_TEST_JAVA_HOME) list.push(process.env.GUIDON_TLS_TEST_JAVA_HOME);
  if (process.env.GUIDON_ANDROID_JAVA_HOME) list.push(process.env.GUIDON_ANDROID_JAVA_HOME);
  if (process.env.JAVA_HOME) list.push(process.env.JAVA_HOME);
  if (process.env.JAVA_HOME_21_X64) list.push(process.env.JAVA_HOME_21_X64);
  if (process.platform === "win32") {
    list.push("C:\\Program Files\\Android\\Android Studio\\jbr");
    if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, "Programs", "Android Studio", "jbr"));
    // This session's own documented standalone JDK21 install convention
    // (guidon-rust-toolchain / guidon-android-toolchain project history):
    // scan ~/.jdk21/* for any subdirectory that looks like a JDK home.
    const jdk21Dir = path.join(homedir(), ".jdk21");
    if (existsSync(jdk21Dir)) {
      try {
        for (const entry of readdirSync(jdk21Dir)) list.push(path.join(jdk21Dir, entry));
      } catch { /* ignore unreadable dir */ }
    }
  } else if (process.platform === "darwin") {
    list.push("/Applications/Android Studio.app/Contents/jbr/Contents/Home");
  } else {
    list.push("/usr/lib/jvm/android-studio/jbr", "/opt/android-studio/jbr");
  }
  return [...new Set(list.filter(Boolean))];
}
function resolveJavaHome() {
  for (const home of candidateJavaHomes()) {
    const bin = path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (!existsSync(bin)) continue;
    const major = javaMajorVersion(bin);
    if (major && major >= REQUIRED_MAJOR) return { home, major, javaBin: bin };
  }
  return null;
}

const jdk = resolveJavaHome();
if (!jdk) {
  info(`no JDK ${REQUIRED_MAJOR}+ found (checked GUIDON_TLS_TEST_JAVA_HOME, GUIDON_ANDROID_JAVA_HOME, JAVA_HOME, JAVA_HOME_21_X64, Android Studio's bundled JBR, ~/.jdk21/*).`);
  info("SKIPPING (exit 0) - this suite needs a real JDK 21+ with keytool. Install one and set JAVA_HOME, or GUIDON_TLS_TEST_JAVA_HOME, to run this for real.");
  process.exit(0);
}
const keytoolBin = path.join(jdk.home, "bin", process.platform === "win32" ? "keytool.exe" : "keytool");
if (!existsSync(keytoolBin)) {
  info(`JDK ${jdk.major} at ${jdk.home} has no bin/keytool - this looks like a JRE, not a full JDK.`);
  info("SKIPPING (exit 0) - install a full JDK 21+.");
  process.exit(0);
}
ok(`found JDK ${jdk.major} at ${jdk.home} (with keytool)`);

/* -------------------------------------------------- Kotlin compiler jars --
   Resolved from this project's own Gradle cache - never a new Gradle/npm
   dependency (see this file's header). Preferred version comes from
   android/variables.gradle's kotlinVersion, the single source of truth
   android/app's own Kotlin build already uses, so this harness tracks it
   automatically rather than hard-coding a second copy that can drift. */
function readKotlinVersion() {
  const text = readFileSync(path.join(APP, "android", "variables.gradle"), "utf-8");
  const m = /kotlinVersion\s*=\s*'([^']+)'/.exec(text);
  return m ? m[1] : null;
}
const kotlinVersion = readKotlinVersion();

function gradleHome() {
  return process.env.GRADLE_USER_HOME || path.join(homedir(), ".gradle");
}
function findGradleJar(groupId, artifactId, preferredVersion) {
  const base = path.join(gradleHome(), "caches", "modules-2", "files-2.1", groupId, artifactId);
  if (!existsSync(base)) return null;
  let versions;
  try { versions = readdirSync(base).filter((v) => { try { return statSync(path.join(base, v)).isDirectory(); } catch { return false; } }); }
  catch { return null; }
  const ordered = preferredVersion && versions.includes(preferredVersion)
    ? [preferredVersion, ...versions.filter((v) => v !== preferredVersion).sort().reverse()]
    : versions.sort().reverse();
  for (const v of ordered) {
    const vDir = path.join(base, v);
    let hashes;
    try { hashes = readdirSync(vDir).filter((h) => { try { return statSync(path.join(vDir, h)).isDirectory(); } catch { return false; } }); }
    catch { continue; }
    for (const h of hashes) {
      const jarPath = path.join(vDir, h, `${artifactId}-${v}.jar`);
      if (existsSync(jarPath)) return { jarPath, version: v };
    }
  }
  return null;
}

const NEEDED = [
  { groupId: "org.jetbrains.kotlin", artifactId: "kotlin-compiler-embeddable", preferVersion: kotlinVersion, key: "compilerEmbeddable" },
  { groupId: "org.jetbrains.kotlin", artifactId: "kotlin-stdlib", preferVersion: kotlinVersion, key: "stdlib" },
  { groupId: "org.jetbrains.kotlin", artifactId: "kotlin-script-runtime", preferVersion: kotlinVersion, key: "scriptRuntime" },
  { groupId: "org.jetbrains.kotlin", artifactId: "kotlin-daemon-embeddable", preferVersion: kotlinVersion, key: "daemonEmbeddable" },
  { groupId: "org.jetbrains.intellij.deps", artifactId: "trove4j", preferVersion: null, key: "trove4j" },
  { groupId: "org.jetbrains", artifactId: "annotations", preferVersion: null, key: "annotations" },
  { groupId: "org.jetbrains.kotlinx", artifactId: "kotlinx-coroutines-core-jvm", preferVersion: null, key: "coroutinesCore" },
];
const resolved = {};
const missing = [];
for (const dep of NEEDED) {
  const found = findGradleJar(dep.groupId, dep.artifactId, dep.preferVersion);
  if (!found) missing.push(`${dep.groupId}:${dep.artifactId}`);
  else resolved[dep.key] = found;
}
if (missing.length) {
  info(`Gradle cache at ${gradleHome()} is missing: ${missing.join(", ")}`);
  info('SKIPPING (exit 0) - run a real Gradle invocation once to populate the cache, e.g. `android\\gradlew.bat -p android help` (Windows) or `./android/gradlew -p android help`, then rerun this suite.');
  process.exit(0);
}
ok(`found kotlin-compiler-embeddable ${resolved.compilerEmbeddable.version} (and its runtime deps) in the Gradle cache at ${gradleHome()}` + (kotlinVersion ? ` (android/variables.gradle wants ${kotlinVersion})` : ""));

const stdlibJar = resolved.stdlib.jarPath;
const compilerCp = [
  // kotlin-compiler-embeddable is itself Kotlin-compiled code (references
  // kotlin.jvm.internal.Intrinsics et al. at its own entry point) - stdlib
  // has to be on the JVM classpath that runs K2JVMCompiler, in addition to
  // being passed via -cp below for the SOURCES being compiled.
  stdlibJar,
  resolved.compilerEmbeddable.jarPath,
  resolved.scriptRuntime.jarPath,
  resolved.daemonEmbeddable.jarPath,
  resolved.trove4j.jarPath,
  resolved.annotations.jarPath,
  resolved.coroutinesCore.jarPath,
].join(path.delimiter);

/* --------------------------------------------------------------- build --
   Compile the REAL production file + the JVM stubs + the harness together,
   in one kotlinc invocation, into a scratch directory - never checked in,
   never reused across runs with stale classes. */
const buildDir = mkdtempSync(path.join(tmpdir(), "guidon-tls-adversarial-"));
const sources = [
  path.join(APP, "android", "app", "src", "main", "java", "app", "guidon", "trainer", "RoomTlsPlugin.kt"),
  path.join(APP, "tools", "tls-adversarial", "stubs", "AndroidUtilBase64Stub.kt"),
  path.join(APP, "tools", "tls-adversarial", "stubs", "CapacitorStub.kt"),
  path.join(APP, "tools", "tls-adversarial", "stubs", "CapacitorAnnotationStub.kt"),
  path.join(APP, "tools", "tls-adversarial", "Harness.kt"),
];
for (const s of sources) {
  if (!existsSync(s)) { bad(`source file missing: ${s}`); console.log(`\ntest-tls-adversarial: ${fails} FAIL(s)`); process.exit(fails); }
}

const compileArgs = [
  "-cp", compilerCp,
  "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
  "-no-stdlib", "-no-reflect",
  "-cp", stdlibJar,
  "-d", buildDir,
  ...sources,
];
const compileResult = spawnSync(jdk.javaBin, compileArgs, { encoding: "utf8" });
if (compileResult.status !== 0) {
  bad("kotlinc failed to compile RoomTlsPlugin.kt + the JVM stubs + the adversarial harness:");
  console.log(compileResult.stdout || "");
  console.log(compileResult.stderr || "");
  rmSync(buildDir, { recursive: true, force: true });
  console.log(`\ntest-tls-adversarial: ${fails} FAIL(s)`);
  process.exit(Math.max(fails, 1));
}
if (compileResult.stdout && compileResult.stdout.trim()) console.log(compileResult.stdout.trim());
ok("compiled the REAL, unmodified RoomTlsPlugin.kt (android/app/src/main/java/app/guidon/trainer/) together with the JVM-only stubs and the adversarial harness - no Android Gradle plugin, no androidx, no Capacitor jar");

/* ---------------------------------------------------------------- run ---
   The harness prints its own PASS/FAIL/KNOWN/INFO lines (see Harness.kt) -
   relay them as-is; its exit code (FAIL count, capped at 255) is the
   authoritative adversarial-suite result.
*/
const runResult = spawnSync(jdk.javaBin, ["-cp", `${buildDir}${path.delimiter}${stdlibJar}`, "guidon.tlstest.HarnessKt"], { encoding: "utf8" });
console.log("");
if (runResult.stdout) console.log(runResult.stdout.trimEnd());
if (runResult.stderr && runResult.stderr.trim()) {
  console.log("--- harness stderr ---");
  console.log(runResult.stderr.trimEnd());
}
rmSync(buildDir, { recursive: true, force: true });

const harnessFails = typeof runResult.status === "number" ? runResult.status : 1;
fails += harnessFails;

console.log(`\ntest-tls-adversarial: ${fails} total FAIL(s) (toolchain-setup + adversarial-case failures combined)`);
process.exit(fails > 0 ? 1 : 0);
