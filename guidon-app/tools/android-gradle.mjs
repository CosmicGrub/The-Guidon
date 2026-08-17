/**
 * Runs the Gradle wrapper in android/ with the right per-platform wrapper
 * script and a JDK 21+ JAVA_HOME - neither of which `npm run android:*`
 * could reliably provide on its own. Two real bugs, found back to back on
 * the same machine while trying to push a build to a device:
 *
 * 1. package.json used to run the wrapper as a bare shell command:
 *      cd android && gradlew assembleDebug
 *    npm shells that string out through cmd.exe on Windows, and it failed
 *    with "'gradlew' is not recognized as an internal or external command" -
 *    even though android/gradlew.bat exists right there in the cwd. Rather
 *    than chase exactly why cmd's lookup didn't fire, this spawns the
 *    wrapper by its real per-platform name directly (`gradlew.bat` here,
 *    `./gradlew` on macOS/Linux), which sidesteps the ambiguity entirely.
 *
 * 2. AGP 8.13.0 at this project's compileSdk (36, see android/variables.gradle)
 *    resolves a Java toolchain that needs a JDK 21+ *compiler*, not just a
 *    JDK 21+ *Gradle launcher*. That requirement is not declared anywhere in
 *    this repo's own .gradle files (grepped, nothing) - it falls out of
 *    AGP/Capacitor's own defaults at this compileSdk level. A machine's
 *    default JAVA_HOME is often an older LTS kept around for other work
 *    (17 is common), which fails with:
 *      "Cannot find a Java installation ... matching:
 *       {languageVersion=21, ...}. Toolchain download repositories have
 *       not been configured."
 *    - an error that never suggests where to actually find a 21. Android
 *    Studio always ships a JDK 21 JBR alongside itself, so this looks
 *    there before giving up.
 *
 * Usage: node tools/android-gradle.mjs <gradle task> [more tasks...]
 *   node tools/android-gradle.mjs assembleDebug
 *   node tools/android-gradle.mjs assembleRelease bundleRelease
 *
 * Override auto-detection by setting GUIDON_ANDROID_JAVA_HOME to a JDK 21+
 * home directly - checked before anything else, for machines where the
 * paths below don't apply.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ANDROID_DIR = join(ROOT, "android");
const REQUIRED_MAJOR = 21;

const tasks = process.argv.slice(2);
if (tasks.length === 0) {
  console.error("usage: node tools/android-gradle.mjs <gradle task> [more tasks...]");
  process.exit(1);
}

function parseMajor(versionOutput) {
  // `java -version` writes to stderr and looks like:
  //   openjdk version "21.0.10" 2026-01-20        (modern scheme)
  //   java version "1.8.0_442"                    (old pre-9 scheme)
  const m = /version "(\d+)(?:\.(\d+))?/.exec(versionOutput || "");
  if (!m) return null;
  const first = parseInt(m[1], 10);
  return first === 1 ? parseInt(m[2], 10) : first;
}

function javaMajorVersion(javaBin) {
  // `-version`'s banner is on stderr regardless of whether the process exits
  // 0 or not (both happen across real JDKs) - execFileSync only hands back
  // stdout on a clean exit, which silently discarded the banner here on a
  // JDK that exits 0. spawnSync returns both streams unconditionally.
  const res = spawnSync(javaBin, ["-version"], { encoding: "utf8" });
  return parseMajor((res.stderr || "") + (res.stdout || ""));
}

function candidateJavaHomes() {
  const list = [];
  if (process.env.GUIDON_ANDROID_JAVA_HOME) list.push(process.env.GUIDON_ANDROID_JAVA_HOME);
  if (process.env.JAVA_HOME) list.push(process.env.JAVA_HOME);
  if (process.env.JAVA_HOME_21_X64) list.push(process.env.JAVA_HOME_21_X64); // actions/setup-java's naming convention
  if (process.platform === "win32") {
    list.push("C:\\Program Files\\Android\\Android Studio\\jbr");
    if (process.env.LOCALAPPDATA) list.push(join(process.env.LOCALAPPDATA, "Programs", "Android Studio", "jbr"));
  } else if (process.platform === "darwin") {
    list.push("/Applications/Android Studio.app/Contents/jbr/Contents/Home");
  } else {
    list.push("/usr/lib/jvm/android-studio/jbr", "/opt/android-studio/jbr");
  }
  return [...new Set(list.filter(Boolean))];
}

function resolveJavaHome() {
  for (const home of candidateJavaHomes()) {
    const bin = join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (!existsSync(bin)) continue;
    const major = javaMajorVersion(bin);
    if (major && major >= REQUIRED_MAJOR) return { home, major };
    if (major) console.log(`  (skipping ${home} - Java ${major}, this build needs ${REQUIRED_MAJOR}+)`);
  }
  return null;
}

const resolved = resolveJavaHome();
if (!resolved) {
  console.error(
    [
      `build: no JDK ${REQUIRED_MAJOR}+ found for the Android Gradle build.`,
      `  Checked GUIDON_ANDROID_JAVA_HOME, JAVA_HOME (currently ${process.env.JAVA_HOME || "not set"}),`,
      `  JAVA_HOME_21_X64, and Android Studio's bundled JBR.`,
      `  Install a JDK ${REQUIRED_MAJOR}+, or open Android Studio at least once so its JBR exists,`,
      `  then either set JAVA_HOME to it or point GUIDON_ANDROID_JAVA_HOME at it directly.`,
    ].join("\n")
  );
  process.exit(1);
}
console.log(`android-gradle: using JDK ${resolved.major} at ${resolved.home}`);

const isWin = process.platform === "win32";
const wrapperAbs = join(ANDROID_DIR, isWin ? "gradlew.bat" : "gradlew");
const env = { ...process.env, JAVA_HOME: resolved.home };

// .bat files cannot be exec'd directly by CreateProcess, so they need cmd.exe
// in the loop somewhere. The obvious fix (shell: true) hits Node's DEP0190:
// with an *array* of args, shell:true only concatenates them without
// escaping, and that alone was enough to make cmd.exe fail to find
// gradlew.bat at all here. Spawning cmd.exe itself as a normal, shell:false
// child avoids that - but this repo's own path has a space in it
// ("APPLICATION Development_APP Creation\..."), and cmd.exe's `/c` does not
// parse a quoted-path-plus-args the way a normal Win32 program's argv does;
// its legacy unquoting heuristic mis-splits on the first space unless the
// *whole* command line is wrapped in one extra pair of quotes. Building that
// string ourselves and passing windowsVerbatimArguments so Node doesn't
// re-quote it out from under us is the documented way to hand cmd.exe a
// command line it won't mangle (see Node's child_process docs, the
// `cmd.exe /c` + windowsVerbatimArguments example).
const child = isWin
  ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${[`"${wrapperAbs}"`, ...tasks].join(" ")}"`], {
      cwd: ANDROID_DIR,
      env,
      stdio: "inherit",
      windowsVerbatimArguments: true,
    })
  : spawn(wrapperAbs, tasks, { cwd: ANDROID_DIR, env, stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
child.on("error", (err) => {
  console.error(`build: failed to launch the Gradle wrapper (${wrapperAbs}): ${err.message}`);
  process.exit(1);
});
