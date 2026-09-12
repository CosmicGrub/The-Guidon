/**
 * Kotlin Gradle-plugin version mirror lint for GUIDON (roadmap audit round
 * 10, "Dependency & CI hygiene cleanup" bucket).
 *
 * android/build.gradle's buildscript{} classpath pins the Kotlin Android
 * Gradle plugin as a hardcoded literal (`org.jetbrains.kotlin:kotlin-
 * gradle-plugin:X.Y.Z`) because buildscript{} always evaluates before
 * `apply from: "variables.gradle"` runs, so ext.kotlinVersion doesn't exist
 * yet at that point in the script (see build.gradle's own comment on the
 * classpath entry). android/variables.gradle's own `kotlinVersion` ext
 * property is meant to track that SAME version, kept in sync by hand -
 * round 9 found and fixed a real drift between the two (build.gradle's
 * classpath had moved on to 2.4.10 while a comment right above it still
 * named the pre-bump 2.0.21), with nothing in CI to catch a repeat. This is
 * that mechanical backstop.
 *
 * Checks (PASS/FAIL lines, exit 1 on any FAIL, style of lint-patterns.mjs):
 *   (a) android/build.gradle declares exactly one
 *       `org.jetbrains.kotlin:kotlin-gradle-plugin:X.Y.Z` classpath entry.
 *   (b) android/variables.gradle declares exactly one `kotlinVersion` ext
 *       property, as a quoted version string.
 *   (c) the two versions are byte-identical.
 *
 * `--build-gradle <path>` and `--variables <path>` point the scan at other
 * copies so the verifier can be verified (a scratch pair with mismatched
 * versions fails, naming both). No dependencies; run from anywhere (paths
 * resolve from this file).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const BUILD_GRADLE = argOf("--build-gradle") || path.join(APP, "android", "build.gradle");
const VARIABLES_GRADLE = argOf("--variables") || path.join(APP, "android", "variables.gradle");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const rel = (p) => path.relative(APP, p).split(path.sep).join("/");

console.log("lint-kotlin-version: android/build.gradle's Kotlin classpath and android/variables.gradle's kotlinVersion must agree\n");

const CLASSPATH_RE = /classpath\s+['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin:([^'"]+)['"]/g;
const VARIABLE_RE = /kotlinVersion\s*=\s*['"]([^'"]+)['"]/g;

async function firstMatch(file, re, label) {
  let text;
  try { text = await readFile(file, "utf-8"); }
  catch (e) { bad(`${rel(file)} unreadable: ${e.message}`); return null; }
  const all = [...text.matchAll(re)].map((m) => m[1]);
  if (all.length === 0) { bad(`${rel(file)} declares no ${label}`); return null; }
  if (all.length > 1) { bad(`${rel(file)} declares ${all.length} ${label} entries (${all.join(", ")}), expected exactly 1`); return null; }
  return all[0];
}

const classpathVersion = await firstMatch(BUILD_GRADLE, CLASSPATH_RE, "kotlin-gradle-plugin classpath");
if (classpathVersion) ok(`${rel(BUILD_GRADLE)} kotlin-gradle-plugin classpath: ${classpathVersion}`);

const variableVersion = await firstMatch(VARIABLES_GRADLE, VARIABLE_RE, "kotlinVersion");
if (variableVersion) ok(`${rel(VARIABLES_GRADLE)} kotlinVersion: ${variableVersion}`);

if (classpathVersion && variableVersion) {
  classpathVersion === variableVersion
    ? ok(`versions agree: ${classpathVersion}`)
    : bad(`version mismatch: ${rel(BUILD_GRADLE)} classpath is ${classpathVersion} but ${rel(VARIABLES_GRADLE)} kotlinVersion is ${variableVersion} - keep them in sync by hand (buildscript{} evaluates before variables.gradle is applied, see build.gradle's own comment on the classpath entry)`);
}

console.log("\n" + (fails ? `LINT-KOTLIN-VERSION: ${fails} FAILURE(S)` : "LINT-KOTLIN-VERSION: all passed"));
process.exit(fails ? 1 : 0);
