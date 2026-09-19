/**
 * Release asset manifest for GUIDON: the ONE list of file names a GitHub
 * Release is supposed to carry, the plain-language "Downloads" section built
 * from whatever is really attached, and the verdict on whether a release is
 * complete enough to be marked Latest.
 *
 * WHY THIS EXISTS. The in-app #/share page (the landing page of the install
 * QR) links to
 *   https://github.com/<repo>/releases/latest/download/GUIDON-android.apk
 *   https://github.com/<repo>/releases/latest/download/GUIDON-windows-setup.exe
 * Those permalinks only work while the release GitHub calls "Latest" carries
 * files under exactly those VERSION-LESS names. That used to be a step the
 * owner remembered by hand. The automated pipeline never adopted it: v1.10.0
 * was published, became Latest with two versioned Windows files and nothing
 * else, and both install buttons in the shipped app went to a GitHub 404.
 * The release body also lost the Downloads table v1.9.0 had. Both are now
 * mechanical: the release workflows upload the aliases named here, and the
 * finalize job below refuses to mark a release Latest until they are
 * attached.
 *
 * The aliases are declared here AND read back out of src/index.html by
 * tools/lint-release-state.mjs, so a new download button in the app with no
 * matching upload fails lint instead of failing a Soldier.
 *
 * Usage (from anywhere; no dependencies, no network):
 *   node tools/release-manifest.mjs names --version 1.12.1
 *       print every expected asset name, one per line
 *   node tools/release-manifest.mjs finalize --version 1.12.1 --tag v1.12.1 \
 *        --repo owner/name --release-json release.json --notes-out notes.md
 *       release.json is `gh release view <tag> --json assets,body` output.
 *       Writes the release body with the Downloads section refreshed and
 *       prints the verdict. Exit 0 = complete (safe to mark Latest),
 *       exit 3 = incomplete (notes still written; do NOT mark Latest),
 *       exit 1 = bad input.
 *
 * Everything the CLI does is exported so tools/test-release-pipeline.mjs can
 * drive the same code the workflows run.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** The version-less names the app links to. Keep in step with #/share. */
export const ALIASES = {
  android: "GUIDON-android.apk",
  windows: "GUIDON-windows-setup.exe",
};

/**
 * Every asset a release is expected to carry.
 *   required: true  -> the release is not complete (never Latest) without it.
 *   required: false -> listed when attached, called out plainly when not.
 * Apple files are built by a separate workflow on its own clock and have
 * never yet been produced by a real run, so they must not be able to hold
 * the working Android and Windows download buttons hostage.
 */
export function expectedAssets(version) {
  const v = String(version || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`release-manifest: "${version}" is not an x.y.z version`);
  return [
    { name: ALIASES.android, group: "android", alias: true, required: true },
    { name: `GUIDON-${v}-android.apk`, group: "android", required: true },
    { name: `GUIDON-${v}-android.aab`, group: "android", required: true },
    { name: ALIASES.windows, group: "windows", alias: true, required: true },
    { name: `GUIDON-${v}-windows-setup.exe`, group: "windows", required: true },
    { name: `GUIDON-${v}-windows.msi`, group: "windows", required: true },
    { name: `GUIDON-${v}-web-pwa.zip`, group: "web", required: true },
    { name: `GUIDON-${v}-standalone.html`, group: "web", required: true },
    { name: `GUIDON-${v}-esp32-flashcardos.bin`, group: "esp32", required: true },
    { name: `GUIDON-${v}-esp32-bootloader.bin`, group: "esp32", required: true },
    { name: `GUIDON-${v}-esp32-partitions.bin`, group: "esp32", required: true },
    { name: `GUIDON-${v}-esp32-cards.ndjson`, group: "esp32", required: true },
    { name: `GUIDON-${v}-esp32-categories.json`, group: "esp32", required: true },
    { name: `GUIDON-${v}-macos-universal.dmg`, group: "macos", required: false },
    { name: `GUIDON-${v}-ios-simulator.zip`, group: "ios-simulator", required: false },
  ];
}

/** complete === every required name (aliases included) is attached. */
export function verdict(version, presentNames) {
  const present = new Set(presentNames || []);
  const expected = expectedAssets(version);
  const missingRequired = expected.filter((a) => a.required && !present.has(a.name)).map((a) => a.name);
  const missingOptional = expected.filter((a) => !a.required && !present.has(a.name)).map((a) => a.name);
  const missingAliases = expected.filter((a) => a.alias && !present.has(a.name)).map((a) => a.name);
  return { complete: missingRequired.length === 0, missingRequired, missingOptional, missingAliases };
}

export const DOWNLOADS_START = "<!-- guidon-downloads:start -->";
export const DOWNLOADS_END = "<!-- guidon-downloads:end -->";

/**
 * The "Downloads" section of the release page. This is read by Soldiers who
 * followed a link looking for an installer, not by developers - so it is
 * plain language, names the device first, and never lists a file that is
 * not really attached (a row is a promise that the link works).
 */
export function renderDownloads({ version, tag, repo, present }) {
  const have = new Set(present || []);
  const url = (name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;
  const link = (name) => `[${name}](${url(name)})`;
  const v = version;
  // The hosted copy GitHub Pages serves for this same repository - the
  // iPhone/iPad install path, and the fallback for anything with a browser.
  const [owner, name] = String(repo).split("/");
  const hosted = `https://${owner.toLowerCase()}.github.io/${name}/`;
  const rows = [];
  const missing = [];

  if (have.has(`GUIDON-${v}-android.apk`)) {
    rows.push(["Android phone or tablet", link(`GUIDON-${v}-android.apk`), "Open it on the phone and allow the install when asked. Your phone will warn that it did not come from the Play Store - that is expected."]);
  } else missing.push("Android");

  if (have.has(`GUIDON-${v}-windows-setup.exe`)) {
    rows.push(["Windows computer", link(`GUIDON-${v}-windows-setup.exe`), "Run it and follow the prompts. It updates an older GUIDON in place and keeps your study progress."]);
  } else missing.push("Windows");
  if (have.has(`GUIDON-${v}-windows.msi`)) {
    rows.push(["Windows, managed computers", link(`GUIDON-${v}-windows.msi`), "The same app as above, in the installer format some unit IT shops ask for."]);
  }

  rows.push(["iPhone or iPad", `[Open GUIDON in Safari](${hosted})`, "Nothing to download. Open the link in Safari, tap Share, then Add to Home Screen."]);

  if (have.has(`GUIDON-${v}-macos-universal.dmg`)) {
    rows.push(["Mac", link(`GUIDON-${v}-macos-universal.dmg`), "Open it and drag GUIDON into Applications. Your Mac may ask you to confirm before it opens an app that did not come from the App Store."]);
  } else {
    rows.push(["Mac or Linux", `[Open GUIDON in your browser](${hosted})`, "There is no separate download for these yet. The link works fully in any browser."]);
  }

  if (have.has(`GUIDON-${v}-standalone.html`)) {
    rows.push(["Any computer, no install", link(`GUIDON-${v}-standalone.html`), "One file. Save it, double-click it, and GUIDON opens in your browser with no internet needed."]);
  }
  if (have.has(`GUIDON-${v}-web-pwa.zip`)) {
    rows.push(["Host it yourself", link(`GUIDON-${v}-web-pwa.zip`), "The full web app as a folder, for anyone who wants to put GUIDON on their own web space."]);
  }
  const espNames = expectedAssets(v).filter((a) => a.group === "esp32").map((a) => a.name);
  if (espNames.every((n) => have.has(n))) {
    rows.push(["GUIDON flashcard handheld", espNames.map(link).join("<br>"), "For the small flashcard device only. The three .bin files go on the device; the card files go on its memory card."]);
  }
  if (have.has(`GUIDON-${v}-android.aab`)) {
    rows.push(["App store upload (not for phones)", link(`GUIDON-${v}-android.aab`), "Store upload package. It will not install on a phone - use the Android file at the top instead."]);
  }

  const out = [DOWNLOADS_START, "## Downloads", "", "Pick the row that matches your device. Everything here works with no internet once it is installed.", "", "| Your device | Get this | What to do |", "|---|---|---|"];
  for (const r of rows) out.push(`| ${r[0]} | ${r[1]} | ${r[2]} |`);
  if (missing.length) {
    out.push("", `**Not attached yet: ${missing.join(" and ")}.** ${missing.length > 1 ? "Those files are" : "That file is"} still being added to this release. Until then the install button inside GUIDON keeps giving you the previous version, which is safe to use.`);
  }
  out.push("", "Already have GUIDON? Installing a newer version over the top keeps your progress.", DOWNLOADS_END);
  return out.join("\n");
}

/** Replace an earlier generated section, or put a fresh one at the top. */
export function mergeBody(existingBody, downloadsSection) {
  const body = String(existingBody || "").replace(/\r\n/g, "\n");
  const s = body.indexOf(DOWNLOADS_START);
  const e = body.indexOf(DOWNLOADS_END);
  if (s !== -1 && e !== -1 && e > s) {
    return (body.slice(0, s) + downloadsSection + body.slice(e + DOWNLOADS_END.length)).trim() + "\n";
  }
  return (downloadsSection + (body.trim() ? "\n\n" + body.trim() : "")).trim() + "\n";
}

/* --------------------------------------------------------------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
  const cmd = process.argv[2];
  try {
    if (cmd === "names") {
      for (const a of expectedAssets(argOf("--version"))) console.log(a.name);
      process.exit(0);
    }
    if (cmd === "finalize") {
      const version = argOf("--version"), tag = argOf("--tag"), repo = argOf("--repo");
      const relPath = argOf("--release-json"), notesOut = argOf("--notes-out");
      if (!version || !tag || !repo || !relPath || !notesOut) throw new Error("finalize needs --version --tag --repo --release-json --notes-out");
      if (tag !== "v" + version) throw new Error(`tag ${tag} does not match version ${version}`);
      const rel = JSON.parse(await readFile(relPath, "utf-8"));
      const present = (rel.assets || []).map((a) => a.name);
      const v = verdict(version, present);
      await writeFile(notesOut, mergeBody(rel.body, renderDownloads({ version, tag, repo, present })), "utf-8");
      console.log(`release-manifest: ${tag} has ${present.length} attached file(s)`);
      if (v.missingOptional.length) console.log("  not attached (does not block): " + v.missingOptional.join(", "));
      if (v.complete) { console.log("  COMPLETE - every required file and both in-app download names are attached"); process.exit(0); }
      console.log("  INCOMPLETE - missing: " + v.missingRequired.join(", "));
      process.exit(3);
    }
    throw new Error("usage: release-manifest.mjs names|finalize ...");
  } catch (e) {
    console.error("release-manifest: " + (e && e.message ? e.message : e));
    process.exit(1);
  }
}
