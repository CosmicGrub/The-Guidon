/**
 * Capability matrix generator (collective roadmap P2, parity design section
 * 5 + X16). Merges the probe files the collectors wrote -
 *   artifacts/caps/<engine>-<device>.json   (verify.mjs, verify-ios-webkit.mjs,
 *                                            test-android.mjs, caps-webview2.mjs)
 *   artifacts/ios/<device>/caps.json        (ios-simulator-run.sh, Simulator)
 * - into docs/generated/capability-matrix.md and .json: one row per
 * capability, one column per accepted probe file, every cell a MEASURED
 * value (yes / no / a recorded string) or "?" when that probe never ran.
 * Nothing in a cell is typed by hand; the row list is the registry in
 * src/app-modules/caps.js (loaded here in a sandbox and asked for list(),
 * ships and the required flags - the same object the app runs).
 *
 * Refusal rules (X16) - a refused file is listed with its reason, never merged:
 *   loopback:true            a self-check artifact (a collector fed its own
 *                            fixture), never evidence
 *   sha not an ancestor      `git merge-base --is-ancestor <sha> HEAD` must
 *                            succeed; a missing/short sha is refused too
 *   engine/fork mismatch     record.engine and record.device must equal the
 *                            file name's tokens, record.fork must be one the
 *                            engine label can carry (LABEL_FORKS: chromium/webkit
 *                            -> web|pwa|standalone|guest, android -> android,
 *                            webview2 -> tauri, ios -> ios), and the payload's
 *                            own fork must agree
 *   ua contradicts label     UA_RULES: chromium needs Chrome/HeadlessChrome,
 *                            webkit needs Safari and no Chrome, webview2 needs
 *                            Edg or Chrome, android needs wv or Chrome
 *   partial caps object      any registry id absent from probe.caps - the app's
 *                            probeAll() always writes every id, a hand-written
 *                            file does not
 *   older than 90 days       collectedAt more than MAX_AGE_DAYS ago
 * Kept but LABELLED, never ship evidence:
 *   isVirtual:true           Simulator/emulator column, "(simulator)"
 *   engineOnly:true          the engine without its OS (Playwright WebKit),
 *                            "(engine only)"
 *   ships[fork] === false    a fork not shipping yet (ios), "(not shipping)"
 * Files are labelled by their real path relative to guidon-app.
 *
 * Gate: exits 1 when a capability marked required in the registry is false,
 * the string "false", an "error:*" string or missing in any EVIDENCE column
 * (accepted, not virtual, not engine-only, fork marked true in the registry's
 * ships map). Also exits 1 when zero EVIDENCE columns exist - a matrix built
 * from nothing, or only from labelled files, must not report green.
 *
 * Usage: node tools/caps-matrix.mjs [--dir <capsDir>] [--ios <iosDir>] [--out <docsDir>] [--dry]
 *        node tools/caps-matrix.mjs --selftest     forged files -> expected refusals/gate
 * PASS/FAIL lines in the style of tools/lint-patterns.mjs. No dependencies.
 */
import { readFile, readdir, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve, basename, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const REPO = resolve(APP, "..");
const REGISTRY_FILE = join(APP, "src", "app-modules", "caps.js");
const MAX_AGE_DAYS = 90;
const LABEL_FORKS = { chromium: ["web", "pwa", "standalone", "guest"], webkit: ["web", "pwa", "standalone", "guest"], android: ["android"], webview2: ["tauri"], ios: ["ios"] };
/* Attestation cross-check (P2 follow-up d): the recorded user agent must be
   one the engine label can produce, so a hand-edited engine/fork field is
   caught by the payload it sits next to. */
const UA_RULES = {
  chromium: { must: /Chrome\/|HeadlessChrome\//, mustNot: null, why: "engine chromium needs Chrome or HeadlessChrome in the ua" },
  webkit: { must: /Safari\//, mustNot: /Chrome\//, why: "engine webkit needs Safari and no Chrome in the ua" },
  webview2: { must: /Edg\/|Chrome\//, mustNot: null, why: "engine webview2 needs Edg or Chrome in the ua" },
  android: { must: /\bwv\b|Chrome\//, mustNot: null, why: "engine android needs wv or Chrome in the ua" },
};

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const SELFTEST = argv.includes("--selftest");
const DRY = argv.includes("--dry");
const CAPS_DIR = resolve(APP, opt("--dir", join("artifacts", "caps")));
const IOS_DIR = resolve(APP, opt("--ios", join("artifacts", "ios")));
const OUT_DIR = resolve(APP, opt("--out", join("docs", "generated")));

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

/* ---------------------------------------------------------------- registry */

/** Runs src/app-modules/caps.js in a sandbox whose global is `window`; only
 *  list()/ships are read - no probe is ever called here. */
export async function loadRegistry(file = REGISTRY_FILE) {
  const src = await readFile(file, "utf8");
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.document = { readyState: "loading", addEventListener() {} };
  sandbox.navigator = {};
  // The same stamp tools/build.mjs writes into window.GUIDON_ENGINE_FLOOR, from
  // the one floor file - so the colorMix degrade text here says what the app says.
  try { sandbox.GUIDON_ENGINE_FLOOR = JSON.parse(await readFile(join(HERE, "engine-floor.json"), "utf8")); } catch (e) { /* unstamped: the registry says so */ }
  vm.runInNewContext(src, sandbox, { filename: file });
  const C = sandbox.G && sandbox.G.caps;
  if (!C || typeof C.list !== "function") throw new Error("caps-matrix: " + file + " did not define G.caps.list()");
  const list = C.list().map((c) => ({ id: c.id, group: c.group, required: !!c.required, expects: c.expects, degrade: c.degrade }));
  return { list, ships: { ...C.ships } };
}

/* -------------------------------------------------------------------- git */

function headSha() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch (e) { return null; }
}
function isAncestor(sha) {
  if (!/^[0-9a-f]{40}$/.test(String(sha || ""))) return false;
  try { execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: REPO, stdio: "ignore" }); return true; }
  catch (e) { return false; }
}

/* ------------------------------------------------------------- discovery */

/** A file's label is its real path relative to guidon-app (forward slashes),
 *  whatever --dir/--ios pointed at - never a hard-coded prefix. */
const relLabel = (file) => relative(APP, file).split(sep).join("/");

async function discover(capsDir, iosDir) {
  const found = [];
  const caps = await readdir(capsDir).catch(() => []);
  for (const f of caps.filter((x) => x.endsWith(".json")).sort()) {
    const m = /^([a-z0-9]+)-(.+)\.json$/.exec(f);
    const file = join(capsDir, f);
    found.push({ file, rel: relLabel(file), engine: m ? m[1] : null, device: m ? m[2] : null });
  }
  const ios = await readdir(iosDir).catch(() => []);
  for (const d of ios.sort()) {
    const p = join(iosDir, d, "caps.json");
    const st = await stat(p).catch(() => null);
    if (st && st.isFile()) found.push({ file: p, rel: relLabel(p), engine: "ios", device: d });
  }
  return found;
}

/* ------------------------------------------------------------- validation */

export function validate(entry, record, { ships, ids = null, now = Date.now(), ancestor = isAncestor }) {
  const reasons = [], labels = [];
  const r = record || {};
  const probe = r.probe || {};
  if (!r || typeof r !== "object" || !probe.caps || typeof probe.caps !== "object") reasons.push("malformed: no probe.caps object");
  else if (Array.isArray(ids)) {
    // a hand-written partial file: the app's probeAll() always writes every registry id
    const missing = ids.filter((id) => !Object.prototype.hasOwnProperty.call(probe.caps, id));
    if (missing.length) reasons.push("caps object is missing registry id(s) " + missing.join(", ") + " - not a probe the app wrote");
  }
  const rule = UA_RULES[entry.engine];
  if (rule) {
    const ua = String(probe.ua || "");
    if (!rule.must.test(ua) || (rule.mustNot && rule.mustNot.test(ua))) reasons.push("ua " + JSON.stringify(ua.slice(0, 80)) + " contradicts the engine label: " + rule.why);
  }
  // (webview2 -> tauri, android -> android, webkit never android: LABEL_FORKS below is the one list for fork-per-label)
  if (r.loopback === true) reasons.push("loopback:true - a self-check artifact, never evidence");
  const at = Date.parse(r.collectedAt || "");
  if (!isFinite(at)) reasons.push("no parsable collectedAt");
  else {
    const days = (now - at) / 86400000;
    if (days > MAX_AGE_DAYS) reasons.push("older than " + MAX_AGE_DAYS + " days (collected " + String(r.collectedAt).slice(0, 10) + ", " + Math.round(days) + " days ago) - re-collect");
    if (days < -1) reasons.push("collectedAt is in the future (" + r.collectedAt + ")");
  }
  if (!entry.engine || !entry.device) reasons.push("file name is not <engine>-<device>.json");
  if (entry.engine && r.engine !== entry.engine) reasons.push("engine field " + JSON.stringify(r.engine) + " does not match the file name's " + JSON.stringify(entry.engine));
  if (entry.device && r.device !== entry.device) reasons.push("device field " + JSON.stringify(r.device) + " does not match the file name's " + JSON.stringify(entry.device));
  const allowed = LABEL_FORKS[entry.engine] || [];
  if (entry.engine && !allowed.includes(r.fork)) reasons.push("fork " + JSON.stringify(r.fork) + " cannot come from engine label " + JSON.stringify(entry.engine) + " (expected " + allowed.join("|") + ")");
  if (probe.fork !== undefined && probe.fork !== r.fork) reasons.push("payload fork " + JSON.stringify(probe.fork) + " disagrees with record fork " + JSON.stringify(r.fork));
  const sha = r.sha || probe.sha || null;
  if (!sha) reasons.push("no sha (page built without GUIDON_BUILD_SHA, or a pre-P2 build) - not this tree");
  else if (!ancestor(sha)) reasons.push("sha " + String(sha).slice(0, 12) + " is not an ancestor of HEAD");
  if (r.isVirtual === true) labels.push("simulator");
  if (r.engineOnly === true) labels.push("engine only");
  if (ships && r.fork && ships[r.fork] === false) labels.push("not shipping");
  if (probe.dirty === true) labels.push("dirty tree");
  const evidence = reasons.length === 0 && r.isVirtual !== true && r.engineOnly !== true && !!(ships && r.fork && ships[r.fork] === true);
  return { accept: reasons.length === 0, reasons, labels, evidence };
}

/* ------------------------------------------------------------------ merge */

export function cellText(v) {
  if (v === true) return "yes";
  if (v === false) return "no";
  if (v === undefined || v === null) return "?";
  const s = String(v);
  return s.indexOf("error:") === 0 ? "error" : s;
}
/* Support means true or a non-empty string naming an implementation; the
   strings "false" and "error:*" are recorded failures, never support. */
const truthy = (v) => v === true || (typeof v === "string" && v.length > 0 && v !== "false" && v.indexOf("error:") !== 0);

export function merge(registry, files) {
  const columns = [], refused = [], cells = {};
  for (const c of registry.list) cells[c.id] = {};
  for (const f of files) {
    const v = f.verdict;
    if (!v.accept) { refused.push({ file: f.rel, reasons: v.reasons }); continue; }
    const r = f.record, p = r.probe;
    const key = r.engine + "-" + r.device;
    columns.push({
      key, file: f.rel, engine: r.engine, device: r.device, fork: r.fork, engineFamily: p.engine || null, engineVersion: p.engineVersion || null,
      collectedAt: r.collectedAt, collector: r.collector || null, sha: r.sha || p.sha || null, dirty: p.dirty === true,
      isVirtual: r.isVirtual === true, engineOnly: r.engineOnly === true, evidence: v.evidence, labels: v.labels, note: r.note || "",
      ua: p.ua || "", viewport: p.viewport || null,
    });
    for (const c of registry.list) cells[c.id][key] = Object.prototype.hasOwnProperty.call(p.caps, c.id) ? p.caps[c.id] : undefined;
  }
  // expectation deviations (informational)
  const deviations = [];
  for (const c of registry.list) for (const col of columns) {
    const e = c.expects && c.expects[col.fork];
    const v = cells[c.id][col.key];
    if (typeof e === "boolean" && (v === true || v === false) && v !== e) deviations.push({ id: c.id, column: col.key, expected: e, measured: v });
    else if (typeof e === "boolean" && typeof v === "string" && truthy(v) !== e) deviations.push({ id: c.id, column: col.key, expected: e, measured: v });
  }
  // gate
  const failures = [];
  for (const col of columns.filter((x) => x.evidence)) for (const c of registry.list.filter((x) => x.required)) {
    const v = cells[c.id][col.key];
    if (!truthy(v)) failures.push({ id: c.id, column: col.key, measured: v === undefined ? "missing" : cellText(v) });
  }
  const evidenceColumns = columns.filter((x) => x.evidence).map((x) => x.key);
  // A matrix with no EVIDENCE column (nothing accepted, or only simulator /
  // engine-only / not-shipping files) has judged nothing and must not be green.
  return { columns, refused, cells, deviations, gate: { ok: failures.length === 0 && evidenceColumns.length > 0, failures, evidenceColumns } };
}

/* ----------------------------------------------------------------- render */

function colHead(col) {
  return col.key + " (" + col.fork + (col.labels.length ? ", " + col.labels.join(", ") : "") + ")";
}

export function renderMarkdown(registry, m, head, generatedAt) {
  const L = [];
  L.push("# Capability matrix");
  L.push("");
  L.push("Generated by `node tools/caps-matrix.mjs` (npm run caps:matrix) at " + generatedAt + " against HEAD " + (head ? head.slice(0, 7) : "unknown") +
    " from " + m.columns.length + " accepted probe file(s), " + m.refused.length + " refused. Do not hand-edit: rows come from the registry in " +
    "`src/app-modules/caps.js` (" + registry.list.length + " capabilities, " + registry.list.filter((c) => c.required).length + " required-for-ships); " +
    "columns are probe files; every cell is a measured value.");
  L.push("");
  L.push("Cells: `yes` / `no` from the probe, a recorded string (which implementation answered, or a value such as origin), `error` when the probe threw, `?` when that file never probed the capability. " +
    "`!` after a cell marks a value that differs from the registry's expectation for that fork (informational). " +
    "A column labelled (simulator) or (engine only) is shown but is never ship evidence; (not shipping) is a fork the registry's ships map has off; (dirty tree) means the build came from uncommitted changes on that sha. " +
    "The gate at the end fails on a required capability that is not `yes` in an evidence column.");
  L.push("");
  L.push("| Capability | group | required | " + m.columns.map(colHead).join(" | ") + " |");
  L.push("|---|---|---|" + m.columns.map(() => "---").join("|") + "|");
  const dev = new Set(m.deviations.map((d) => d.id + "\u0000" + d.column));
  for (const c of registry.list) {
    const row = m.columns.map((col) => cellText(m.cells[c.id][col.key]) + (dev.has(c.id + "\u0000" + col.key) ? " !" : ""));
    L.push("| " + c.id + " | " + c.group + " | " + (c.required ? "yes" : "") + " | " + row.join(" | ") + " |");
  }
  L.push("");
  L.push("## Columns");
  L.push("");
  if (!m.columns.length) L.push("(none accepted)");
  for (const col of m.columns) {
    L.push("- **" + col.key + "**: fork " + col.fork + ", " + (col.engineFamily || "?") + " " + (col.engineVersion || "?") + ", collected " + String(col.collectedAt).slice(0, 19).replace("T", " ") +
      " by " + (col.collector || "?") + ", sha " + (col.sha ? col.sha.slice(0, 7) : "none") + (col.dirty ? " (dirty tree)" : "") +
      ", evidence: " + (col.evidence ? "yes" : "no" + (col.labels.length ? " (" + col.labels.join(", ") + ")" : "")) + (col.note ? " - " + col.note : ""));
  }
  L.push("");
  L.push("## Degradation when absent");
  L.push("");
  for (const c of registry.list) L.push("- **" + c.id + "**" + (c.required ? " (required)" : "") + ": " + c.degrade);
  L.push("");
  L.push("## Deviations from the registry's expectations");
  L.push("");
  if (!m.deviations.length) L.push("(none)");
  for (const d of m.deviations) L.push("- " + d.id + " on " + d.column + ": expected " + d.expected + ", measured " + cellText(d.measured));
  L.push("");
  L.push("## Refused files");
  L.push("");
  if (!m.refused.length) L.push("(none)");
  for (const r of m.refused) L.push("- " + r.file + ": " + r.reasons.join("; "));
  L.push("");
  L.push("## Gate");
  L.push("");
  L.push("Evidence columns: " + (m.gate.evidenceColumns.length ? m.gate.evidenceColumns.join(", ") : "(none)"));
  if (m.gate.ok) L.push("PASS - every required capability is present on every evidence column.");
  else if (!m.columns.length) L.push("FAIL - no accepted probe file; nothing was measured.");
  else if (!m.gate.evidenceColumns.length) L.push("FAIL - no evidence column (every accepted file is simulator, engine-only or not-shipping); nothing was judged.");
  else for (const f of m.gate.failures) L.push("FAIL - " + f.id + " is " + f.measured + " on " + f.column);
  L.push("");
  return L.join("\n");
}

/* ------------------------------------------------------------------ main */

async function readAll(entries, ctx) {
  const out = [];
  for (const e of entries) {
    let record = null, parseErr = null;
    try { record = JSON.parse(await readFile(e.file, "utf8")); } catch (err) { parseErr = err.message; }
    const verdict = parseErr ? { accept: false, reasons: ["unreadable JSON: " + parseErr], labels: [], evidence: false } : validate(e, record, ctx);
    out.push({ ...e, record, verdict });
  }
  return out;
}

async function generate() {
  console.log("caps-matrix: merge artifacts/caps/*.json + artifacts/ios/*/caps.json -> docs/generated/capability-matrix.{md,json}\n");
  const registry = await loadRegistry();
  ok("registry loaded from src/app-modules/caps.js: " + registry.list.length + " capabilities, " + registry.list.filter((c) => c.required).length + " required, ships " + JSON.stringify(registry.ships));
  const head = headSha();
  const entries = await discover(CAPS_DIR, IOS_DIR);
  const files = await readAll(entries, { ships: registry.ships, ids: registry.list.map((c) => c.id) });
  for (const f of files) console.log("  " + (f.verdict.accept ? "ACCEPT" : "REFUSE") + "  " + f.rel + (f.verdict.labels.length ? " [" + f.verdict.labels.join(", ") + "]" : "") + (f.verdict.accept ? "" : " - " + f.verdict.reasons.join("; ")));
  const m = merge(registry, files);
  const generatedAt = new Date().toISOString();
  const md = renderMarkdown(registry, m, head, generatedAt);
  const json = { schema: 1, generatedAt, head, maxAgeDays: MAX_AGE_DAYS, registry: registry.list, ships: registry.ships, columns: m.columns, cells: m.cells, deviations: m.deviations, refused: m.refused, gate: m.gate };
  if (md.includes("\r")) bad("generated markdown contains CR bytes");
  if (!DRY) {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(join(OUT_DIR, "capability-matrix.md"), md, "utf8");
    await writeFile(join(OUT_DIR, "capability-matrix.json"), JSON.stringify(json, null, 2) + "\n", "utf8");
    ok("wrote " + join("docs", "generated", "capability-matrix.md") + " and .json (" + m.columns.length + " column(s), " + registry.list.length + " rows)");
  } else ok("--dry: nothing written (" + m.columns.length + " column(s) would be merged)");
  m.columns.length ? ok(m.columns.length + " probe file(s) accepted: " + m.columns.map((c) => c.key).join(", ")) : bad("no probe file accepted - run npm run verify (and the other collectors) first");
  if (m.refused.length) console.log("  INFO  " + m.refused.length + " refused: " + m.refused.map((r) => basename(r.file)).join(", "));
  if (m.deviations.length) console.log("  INFO  " + m.deviations.length + " deviation(s) from expectations (informational, see the markdown)");
  if (m.gate.ok) ok("gate: every required capability present on evidence column(s) " + m.gate.evidenceColumns.join(", "));
  else if (m.columns.length) for (const f of m.gate.failures) bad("gate: required capability " + f.id + " is " + f.measured + " on " + f.column);
  if (m.columns.length && !m.gate.evidenceColumns.length) bad("gate: no evidence column (every accepted file is simulator/engine-only/not-shipping) - nothing was judged, so this is not green");
  finish("CAPS-MATRIX");
}

/* --------------------------------------------------------------- selftest */

async function selftest() {
  console.log("caps-matrix --selftest: forged probe files must be refused, a good one accepted, a gap must fail the gate\n");
  const registry = await loadRegistry();
  const head = headSha();
  if (!head) { bad("git rev-parse HEAD failed - cannot self-test the ancestry rule"); return finish("CAPS-MATRIX-SELFTEST"); }
  const dir = join(tmpdir(), "guidon-caps-selftest-" + process.pid);
  const capsDir = join(dir, "caps"), iosDir = join(dir, "ios", "iphone-16");
  await mkdir(capsDir, { recursive: true });
  await mkdir(iosDir, { recursive: true });
  const allTrue = {}; for (const c of registry.list) allTrue[c.id] = c.id === "origin" ? "http://127.0.0.1:1" : true;
  // Realistic user agents per engine label, the shape the attestation
  // cross-check (validate, rule ua) reads: the real collectors record these.
  const UA = {
    chromium: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36",
    webkit: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
    webview2: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36",
    ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  };
  const rec = (over, probeOver) => {
    const engine = (over && over.engine) || "chromium";
    const fork = (over && over.fork) || "web";
    return {
      schema: 1, collector: "selftest", collectedAt: new Date().toISOString(), engine: "chromium", device: "good", fork: "web", sha: head,
      loopback: false, isVirtual: false, engineOnly: false, note: "", ...over,
      probe: { schema: 1, fork, engine: engine === "webkit" || engine === "ios" ? "webkit" : "chromium", engineVersion: 140, ua: UA[engine] || UA.chromium, sha: head, dirty: false, builtAt: "2026-09-04", isVirtual: false, caps: { ...allTrue }, ...(probeOver || {}) },
    };
  };
  const w = (name, obj) => writeFile(join(capsDir, name), JSON.stringify(obj) + "\n", "utf8");
  await w("chromium-good.json", rec({ device: "good" }));
  await w("chromium-forged.json", rec({ device: "forged", sha: "0".repeat(40) }, { sha: "0".repeat(40) }));
  await w("chromium-loop.json", rec({ device: "loop", loopback: true }));
  await w("chromium-stale.json", rec({ device: "stale", collectedAt: new Date(Date.now() - 91 * 86400000).toISOString() }));
  await w("webkit-mismatch.json", rec({ device: "mismatch", engine: "chromium" }));
  await w("android-wrongfork.json", rec({ device: "wrongfork", engine: "android", fork: "web" }));
  await w("chromium-gap.json", rec({ device: "gap" }, { caps: { ...allTrue, indexeddb: false } }));
  await w("webkit-engineonly.json", rec({ device: "engineonly", engine: "webkit", engineOnly: true }, { caps: { ...allTrue, storagePersist: false } }));
  await writeFile(join(iosDir, "caps.json"), JSON.stringify(rec({ engine: "ios", device: "iphone-16", fork: "ios", isVirtual: true })) + "\n", "utf8");
  // (b) forks standalone and guest earn columns under a browser engine label
  await w("chromium-standalone.json", rec({ device: "standalone", fork: "standalone" }, { caps: { ...allTrue, origin: "null" } }));
  await w("chromium-guest.json", rec({ device: "guest", fork: "guest" }, { caps: { ...allTrue, webCrypto: false, secureContext: false } }));
  // (c) the strings "false" and "error:*" are not support
  await w("chromium-strfalse.json", rec({ device: "strfalse" }, { caps: { ...allTrue, indexeddb: "false", print: "error:boom" } }));
  // (d) attestation: ua vs engine/fork, and a hand-written partial caps object
  await w("chromium-uasafari.json", rec({ device: "uasafari" }, { ua: UA.webkit }));
  await w("webkit-uachrome.json", rec({ device: "uachrome", engine: "webkit" }, { ua: UA.chromium }));
  await w("webview2-uaplain.json", rec({ device: "uaplain", engine: "webview2", fork: "tauri" }, { ua: UA.webkit }));
  await w("android-uanowv.json", rec({ device: "uanowv", engine: "android", fork: "android" }, { ua: UA.webkit }));
  await w("webkit-android.json", rec({ device: "android", engine: "webkit", fork: "android" }, { ua: UA.android }));
  const partial = { ...allTrue }; delete partial.colorMix; delete partial.webSocket;
  await w("chromium-partial.json", rec({ device: "partial" }, { caps: partial }));
  try {
    const entries = await discover(capsDir, join(dir, "ios"));
    const files = await readAll(entries, { ships: registry.ships, ids: registry.list.map((c) => c.id) });
    const by = (n) => files.find((f) => basename(f.file) === n || f.rel.endsWith(n));
    const expectRefused = (name, re, why) => { const f = by(name); f && !f.verdict.accept && f.verdict.reasons.some((r) => re.test(r)) ? ok(name + " refused: " + why) : bad(name + " expected refusal " + re + ", got " + JSON.stringify(f && f.verdict)); };
    expectRefused("chromium-forged.json", /not an ancestor/, "forged sha (all zeros) is not an ancestor of HEAD");
    expectRefused("chromium-loop.json", /loopback/, "loopback:true");
    expectRefused("chromium-stale.json", /older than 90 days/, "91 days old");
    expectRefused("webkit-mismatch.json", /engine field/, "engine field chromium vs file name webkit");
    expectRefused("android-wrongfork.json", /cannot come from engine label/, "fork web under the android label");
    const good = by("chromium-good.json");
    good && good.verdict.accept && good.verdict.evidence ? ok("chromium-good.json accepted as evidence (HEAD sha, in date, consistent)") : bad("chromium-good.json verdict: " + JSON.stringify(good && good.verdict));
    const eo = by("webkit-engineonly.json");
    eo && eo.verdict.accept && !eo.verdict.evidence && eo.verdict.labels.includes("engine only") ? ok("webkit-engineonly.json accepted, labelled engine only, not evidence") : bad("webkit-engineonly.json verdict: " + JSON.stringify(eo && eo.verdict));
    const sim = by("caps.json");
    sim && sim.verdict.accept && !sim.verdict.evidence && sim.verdict.labels.includes("simulator") && sim.verdict.labels.includes("not shipping") ? ok("ios/iphone-16/caps.json accepted, labelled simulator + not shipping, not evidence") : bad("ios caps.json verdict: " + JSON.stringify(sim && sim.verdict));
    // (b)
    const sa = by("chromium-standalone.json");
    sa && sa.verdict.accept && sa.verdict.evidence ? ok("(b) chromium-standalone.json (fork standalone) accepted as evidence - ships.standalone is true") : bad("(b) chromium-standalone.json verdict: " + JSON.stringify(sa && sa.verdict));
    const gu = by("chromium-guest.json");
    gu && gu.verdict.accept && !gu.verdict.evidence ? ok("(b) chromium-guest.json (fork guest) accepted as a column, not evidence (guest is not in the ships map)") : bad("(b) chromium-guest.json verdict: " + JSON.stringify(gu && gu.verdict));
    // (d)
    expectRefused("chromium-uasafari.json", /ua /, "engine chromium but the ua carries no Chrome/HeadlessChrome");
    expectRefused("webkit-uachrome.json", /ua /, "engine webkit but the ua carries Chrome");
    expectRefused("webview2-uaplain.json", /ua /, "engine webview2 but the ua carries neither Edg nor Chrome");
    expectRefused("android-uanowv.json", /ua /, "engine android but the ua carries neither wv nor Chrome");
    expectRefused("webkit-android.json", /cannot come from engine label|ua /, "a webkit file claiming fork android");
    expectRefused("chromium-partial.json", /missing registry id/, "caps object lacks colorMix and webSocket (hand-written partial file)");
    // (e)
    const relOk = entries.every((e) => e.rel === relative(APP, e.file).split(sep).join("/")) && entries.every((e) => e.rel.indexOf("artifacts/caps/") !== 0);
    relOk ? ok("(e) discover() labels each file by its real path relative to guidon-app (" + entries[0].rel + "), not a hard-coded artifacts/caps/ prefix") : bad("(e) discover() rel labels: " + entries.map((e) => e.rel).join(", "));
    const m = merge(registry, files);
    m.columns.length === 7 ? ok("merge keeps exactly the 7 accepted columns (" + m.columns.map((c) => c.key).join(", ") + ")") : bad("merged columns (" + m.columns.length + "): " + m.columns.map((c) => c.key).join(", "));
    m.refused.length === 11 ? ok("merge lists the 11 refused files with reasons") : bad("refused count " + m.refused.length + ": " + m.refused.map((r) => basename(r.file)).join(", "));
    const gap = m.gate.failures.find((f) => f.id === "indexeddb" && f.column === "chromium-gap");
    !m.gate.ok && gap ? ok("gate FAILS naming indexeddb on chromium-gap (required, measured no)") : bad("gate: " + JSON.stringify(m.gate));
    // (c)
    const sf = m.gate.failures.find((f) => f.id === "indexeddb" && f.column === "chromium-strfalse");
    const se = m.gate.failures.find((f) => f.id === "print" && f.column === "chromium-strfalse");
    sf && se ? ok("(c) gate FAILS on the strings \"false\" (indexeddb) and \"error:boom\" (print) on chromium-strfalse") : bad("(c) gate failures on chromium-strfalse: " + JSON.stringify(m.gate.failures.filter((f) => f.column === "chromium-strfalse")));
    m.gate.failures.every((f) => f.column !== "webkit-engineonly") ? ok("the engine-only column's false storagePersist never reaches the gate") : bad("engine-only column judged by the gate");
    m.gate.failures.every((f) => f.column !== "chromium-guest") ? ok("the guest column's false webCrypto/secureContext never reaches the gate (not evidence)") : bad("guest column judged by the gate");
    const md = renderMarkdown(registry, m, head, "selftest");
    /^\| indexeddb \| storage \| yes \| /m.test(md) && md.includes("| chromium-gap (web) |") ? ok("markdown renders the registry rows and the column heads") : bad("markdown shape unexpected");
    !md.includes("\r") && /^[\x00-\x7f]*$/.test(md) ? ok("markdown is LF-only ASCII") : bad("markdown has CR or non-ASCII bytes");
    const withoutGap = merge(registry, files.filter((f) => !/chromium-(gap|strfalse)\.json$/.test(f.rel)));
    withoutGap.gate.ok ? ok("gate PASSES once the gap and strfalse files are removed") : bad("gate without the gap files: " + JSON.stringify(withoutGap.gate.failures));
    // (a) zero evidence columns
    const labelledOnly = merge(registry, files.filter((f) => /webkit-engineonly\.json$|caps\.json$/.test(f.rel)));
    labelledOnly.columns.length === 2 && labelledOnly.gate.evidenceColumns.length === 0 && !labelledOnly.gate.ok
      ? ok("(a) gate FAILS with 2 accepted but zero EVIDENCE columns (engine-only + simulator only)")
      : bad("(a) gate with labelled-only columns: " + JSON.stringify(labelledOnly.gate));
    const none = merge(registry, []);
    !none.gate.ok ? ok("(a) gate FAILS with zero accepted files") : bad("(a) gate passed on nothing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  finish("CAPS-MATRIX-SELFTEST");
}

function finish(tag) {
  console.log("\n" + (fails ? tag + ": " + fails + " FAILURE(S)" : tag + ": all passed"));
  process.exit(fails ? 1 : 0);
}

// Self-invoke only when run directly (same idiom as tools/build.mjs), so a
// future suite can import validate()/merge()/renderMarkdown() without
// triggering a generation as an import side effect.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  (SELFTEST ? selftest() : generate()).catch((e) => { console.error(String(e && e.stack || e)); process.exit(2); });
}
