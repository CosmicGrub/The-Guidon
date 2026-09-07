/**
 * Network-floor gate (room-tls-and-discovery-pitch.md Section 3, "The
 * networking-capabilities floor"): merges the REAL per-fork measurements
 * tools/test-network-floor.mjs wrote to artifacts/net-floor/<fork>-
 * <device>.json (schema guidon-netfloor/1) against a fork-aware
 * expectation table, and fails loudly on anything less than real, fresh,
 * passing evidence for a fork that expects one. This is the DESTRUCTIVE
 * lane the pitch doc asks for, parallel to (never a replacement for)
 * src/app-modules/caps.js's cheap, synchronous, non-destructive
 * webSocket/rtcDataChannel existence probes - see that file's degrade text
 * for the "existence only" boundary this tool exists to cross.
 *
 * Expectation table (NET_FLOOR_EXPECT below): `true` means "a fresh,
 * passing artifacts/net-floor/<fork>-*.json must exist or this fails";
 * `"n/a"` (standalone: file://, no network of any kind - see caps.js)
 * and `"unknown"` (ios: no device track in this repo yet) are
 * informational only and never gate. android is `true`, NOT the old
 * sentinel string `"blocked-until-wss"` - the pinned self-signed WSS fix
 * (RoomTlsPlugin.kt registered in MainActivity, room-web.js's native-
 * transport routing, src-tauri/src/room.rs's TLS listener) is real,
 * shipped, and independently verified on real hardware (2026-09-06); the
 * table says so and a real tools/test-network-floor.mjs --fork android
 * measurement is what proves it, every time this gate runs - never a
 * hard-coded pass and never a silent downgrade back to "blocked" to make
 * a red run go away. If you are here because android measurement is
 * missing/stale/failing, that is the honest, correct answer: go collect
 * one (or investigate a real regression), don't edit the table.
 *
 * Same MAX_AGE_DAYS-style staleness discipline as tools/caps-matrix.mjs:
 * gate on staleness/absence, never fabricate a CI-only measurement for a
 * fork this environment cannot actually reach (a hosted CI runner has no
 * Android device and no Windows Tauri build - see this repo's own
 * ci.yml "EXCLUDED ON PURPOSE" precedent for android for the same reason).
 *
 * Usage: node tools/lint-network-floor.mjs [--dir <artifacts/net-floor>]
 *        node tools/lint-network-floor.mjs --selftest   forged files -> expected verdicts
 * PASS/FAIL lines in the style of tools/lint-ci-matrix.mjs / tools/caps-
 * matrix.mjs. Exit 1 on any FAIL. No dependencies.
 */
import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const MAX_AGE_DAYS = 90;

/* The one place this table lives. `true` gates; a string is informational
   (caps.js's own `expects` convention: never a boolean, never gates). */
const NET_FLOOR_EXPECT = { web: true, pwa: true, tauri: true, standalone: "n/a", android: true, ios: "unknown" };
// Safety net: if this ever regresses back to the pre-fix sentinel string
// (by a careless revert, a bad merge, whatever), fail loudly and specifically
// rather than silently gating on the wrong thing.
if (NET_FLOOR_EXPECT.android === "blocked-until-wss") {
  console.log("  FAIL  NET_FLOOR_EXPECT.android is still the pre-fix sentinel \"blocked-until-wss\" - the pinned WSS fix has shipped and is verified on real hardware (2026-09-06); this must be `true`. Do not hand-edit this back down to make a red run go away.");
  console.log("\nLINT-NETWORK-FLOOR: 1 FAILURE(S)");
  process.exit(1);
}

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const SELFTEST = argv.includes("--selftest");
const DIR = resolve(APP, opt("--dir", join("artifacts", "net-floor")));

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);

console.log("lint-network-floor: artifacts/net-floor/*.json vs the fork-aware expectation table" + (SELFTEST ? " (--selftest)" : "") + "\n");

/* ---------------------------------------------------------------------
   validate(): one file's verdict. Exported so a selftest (or a future
   suite) can call it directly, same shape as tools/caps-matrix.mjs's own
   validate()/merge() split.
   --------------------------------------------------------------------- */
export function validate(entry, record, { now = Date.now() } = {}) {
  const reasons = [];
  const r = record || {};
  if (!r || typeof r !== "object") { reasons.push("unreadable / not an object"); return { accept: false, reasons }; }
  if (r.schema !== "guidon-netfloor/1") reasons.push("schema is " + JSON.stringify(r.schema) + ", expected \"guidon-netfloor/1\"");
  if (typeof r.fork !== "string" || !r.fork) reasons.push("no fork field");
  if (typeof r.device !== "string" || !r.device) reasons.push("no device field");
  if (typeof r.ok !== "boolean") reasons.push("ok is " + JSON.stringify(r.ok) + ", not a boolean");
  const at = Date.parse(r.collectedAt || "");
  let days = null;
  if (!isFinite(at)) reasons.push("no parsable collectedAt");
  else {
    days = (now - at) / 86400000;
    if (days > MAX_AGE_DAYS) reasons.push("stale: collected " + String(r.collectedAt).slice(0, 10) + ", " + Math.round(days) + " days ago (> " + MAX_AGE_DAYS + ")");
    if (days < -1) reasons.push("collectedAt is in the future (" + r.collectedAt + ")");
  }
  if (entry.fork && r.fork && entry.fork !== r.fork) reasons.push("file name fork " + JSON.stringify(entry.fork) + " does not match record fork " + JSON.stringify(r.fork));
  return { accept: reasons.length === 0, reasons, fork: r.fork, device: r.device, okValue: r.ok === true, days, note: r.note || "", detail: r.detail || {} };
}

async function discover(dir) {
  const files = await readdir(dir).catch(() => []);
  const out = [];
  for (const f of files.filter((x) => x.endsWith(".json")).sort()) {
    const m = /^([a-z]+)-(.+)\.json$/.exec(f);
    out.push({ file: join(dir, f), rel: "artifacts/net-floor/" + f, fork: m ? m[1] : null, device: m ? m[2] : null });
  }
  return out;
}

async function readAll(entries, ctx) {
  const out = [];
  for (const e of entries) {
    let record = null;
    try { record = JSON.parse(await readFile(e.file, "utf8")); } catch (err) { out.push({ ...e, verdict: { accept: false, reasons: ["unreadable JSON: " + err.message] } }); continue; }
    out.push({ ...e, record, verdict: validate(e, record, ctx) });
  }
  return out;
}

/* ---------------------------------------------------------------------
   gate(): per-fork verdict against NET_FLOOR_EXPECT. Returns
   { rows: [{fork, expect, status, reasons}], ok }. status is one of
   "pass" | "fail-missing" | "fail-stale" | "fail-not-ok" | "info".
   --------------------------------------------------------------------- */
export function gate(expectTable, files) {
  const rows = [];
  let anyFail = false;
  for (const [fork, expect] of Object.entries(expectTable)) {
    const accepted = files.filter((f) => f.verdict.accept && f.verdict.fork === fork);
    const refusedForFork = files.filter((f) => !f.verdict.accept && f.fork === fork);
    if (expect !== true) {
      rows.push({ fork, expect, status: "info", accepted: accepted.length, refused: refusedForFork.length });
      continue;
    }
    if (accepted.length === 0) {
      const why = refusedForFork.length
        ? "no ACCEPTED measurement (" + refusedForFork.length + " file(s) present but refused: " + refusedForFork.map((f) => f.rel + " [" + f.verdict.reasons.join("; ") + "]").join(" | ") + ")"
        : "no artifacts/net-floor/" + fork + "-*.json file at all - run: node tools/test-network-floor.mjs --fork " + fork;
      rows.push({ fork, expect, status: "fail-missing", reason: why });
      anyFail = true;
      continue;
    }
    const passing = accepted.filter((f) => f.verdict.okValue);
    if (passing.length === 0) {
      rows.push({
        fork, expect, status: "fail-not-ok",
        reason: accepted.map((f) => f.rel + ": ok=false, detail=" + JSON.stringify(f.record.detail || {})).join(" | "),
      });
      anyFail = true;
      continue;
    }
    rows.push({ fork, expect, status: "pass", files: passing.map((f) => f.rel) });
  }
  return { rows, ok: !anyFail };
}

/* --------------------------------------------------------------------- run */
async function run(dir) {
  const entries = await discover(dir);
  const files = await readAll(entries, { now: Date.now() });
  for (const f of files) {
    if (f.verdict.accept) info("accepted " + f.rel + " (fork " + f.verdict.fork + ", ok=" + f.verdict.okValue + ", " + Math.round(f.verdict.days) + "d old)");
    else info("refused  " + f.rel + " - " + f.verdict.reasons.join("; "));
  }
  const g = gate(NET_FLOOR_EXPECT, files);
  for (const row of g.rows) {
    if (row.status === "info") ok("(" + row.fork + ") expect=" + JSON.stringify(row.expect) + " - informational, never gates (" + row.accepted + " accepted, " + row.refused + " refused on disk)");
    else if (row.status === "pass") ok("(" + row.fork + ") real, fresh, PASSING evidence: " + row.files.join(", "));
    else if (row.status === "fail-missing") bad("(" + row.fork + ") expects a real measurement but has none: " + row.reason);
    else if (row.status === "fail-not-ok") {
      if (row.fork === "android") bad("(android) REGRESSION: the pinned-WSS fix is supposed to be shipped and verified, but the real measurement says it is NOT working right now: " + row.reason);
      else bad("(" + row.fork + ") a real measurement exists but is not ok: " + row.reason);
    }
  }
  return g.ok;
}

if (SELFTEST) {
  await selftest();
} else {
  const good = await run(DIR);
  console.log("\n" + (fails ? `LINT-NETWORK-FLOOR: ${fails} FAILURE(S)` : "LINT-NETWORK-FLOOR: all passed") + (good === false && fails === 0 ? " (inconsistent gate state)" : ""));
  process.exit(fails ? 1 : 0);
}

/* --------------------------------------------------------------- selftest */
async function selftest() {
  const dir = join(tmpdir(), "guidon-net-floor-selftest-" + process.pid);
  await mkdir(dir, { recursive: true });
  const now = Date.now();
  const rec = (fork, device, over) => ({ schema: "guidon-netfloor/1", fork, device, collector: "selftest", collectedAt: new Date(now).toISOString(), room: "NFLR-CHCK-42", ok: true, ms: { helloMs: 5, welcomeMs: 5 }, detail: {}, note: "", ...over });
  const w = (name, obj) => writeFile(join(dir, name), JSON.stringify(obj) + "\n", "utf8");
  try {
    await w("web-chromium.json", rec("web", "chromium"));
    await w("pwa-chromium-pwa.json", rec("pwa", "chromium-pwa"));
    await w("tauri-desktop.json", rec("tauri", "desktop"));
    await w("android-fold5.json", rec("android", "fold5"));
    // missing: standalone (n/a, fine) and ios (unknown, fine) - never gate

    let g = gate(NET_FLOOR_EXPECT, await readAll(await discover(dir), { now }));
    g.ok ? ok("(selftest) all-true-forks-passing + no standalone/ios files -> gate PASSES") : bad("(selftest) expected PASS, got " + JSON.stringify(g.rows));

    // (1) missing android entirely -> FAIL, named
    await rm(join(dir, "android-fold5.json"));
    g = gate(NET_FLOOR_EXPECT, await readAll(await discover(dir), { now }));
    const androidRow = g.rows.find((r) => r.fork === "android");
    !g.ok && androidRow && androidRow.status === "fail-missing" ? ok("(selftest) android measurement missing -> gate FAILS naming android, never silently skipped") : bad("(selftest) missing-android verdict: " + JSON.stringify(androidRow));
    await w("android-fold5.json", rec("android", "fold5")); // restore

    // (2) android ok:false -> FAIL as a REGRESSION, never downgraded to "expected"
    await w("android-fold5.json", rec("android", "fold5", { ok: false, detail: { reason: "hello never reached the host" } }));
    g = gate(NET_FLOOR_EXPECT, await readAll(await discover(dir), { now }));
    const androidFail = g.rows.find((r) => r.fork === "android");
    !g.ok && androidFail && androidFail.status === "fail-not-ok" ? ok("(selftest) android measurement present but ok:false -> gate FAILS (a real regression, not a reason to relax the table)") : bad("(selftest) android ok:false verdict: " + JSON.stringify(androidFail));
    await w("android-fold5.json", rec("android", "fold5")); // restore

    // (3) stale tauri (91 days) -> FAIL, named stale
    await w("tauri-desktop.json", rec("tauri", "desktop", { collectedAt: new Date(now - 91 * 86400000).toISOString() }));
    const files3 = await readAll(await discover(dir), { now });
    const tauriFile = files3.find((f) => f.fork === "tauri");
    !tauriFile.verdict.accept && tauriFile.verdict.reasons.some((r) => /stale/.test(r)) ? ok("(selftest) a 91-day-old tauri record is refused as stale (MAX_AGE_DAYS=" + MAX_AGE_DAYS + ")") : bad("(selftest) stale tauri verdict: " + JSON.stringify(tauriFile.verdict));
    g = gate(NET_FLOOR_EXPECT, files3);
    const tauriRow = g.rows.find((r) => r.fork === "tauri");
    !g.ok && tauriRow.status === "fail-missing" ? ok("(selftest) a stale-only file counts as no accepted evidence -> gate FAILS naming tauri") : bad("(selftest) stale-tauri gate row: " + JSON.stringify(tauriRow));
    await w("tauri-desktop.json", rec("tauri", "desktop")); // restore

    // (4) malformed schema -> refused, never silently accepted
    await w("web-second.json", { schema: "something-else", fork: "web", device: "second", collectedAt: new Date(now).toISOString(), ok: true });
    const files4 = await readAll(await discover(dir), { now });
    const bogus = files4.find((f) => f.device === "second");
    !bogus.verdict.accept && bogus.verdict.reasons.some((r) => /schema/.test(r)) ? ok("(selftest) a wrong-schema file is refused, never merged as evidence") : bad("(selftest) wrong-schema verdict: " + JSON.stringify(bogus.verdict));
    await rm(join(dir, "web-second.json"));

    // (5) the sentinel guard itself (run out of process so it cannot exit this one)
    ok("(selftest) NET_FLOOR_EXPECT.android is " + JSON.stringify(NET_FLOOR_EXPECT.android) + " (the sentinel-regression guard above already refuses to run at all if this reverts to \"blocked-until-wss\")");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log("\n" + (fails ? `LINT-NETWORK-FLOOR-SELFTEST: ${fails} FAILURE(S)` : "LINT-NETWORK-FLOOR-SELFTEST: all passed"));
  process.exit(fails ? 1 : 0);
}
