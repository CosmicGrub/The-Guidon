/**
 * Shared plumbing for every capability collector (collective roadmap P2,
 * parity design section 5): tools/verify.mjs (Chromium, web/),
 * tools/verify-ios-webkit.mjs (Playwright WebKit, engine only),
 * tools/test-android.mjs (adb-forwarded CDP into the shipped WebView) and
 * tools/caps-webview2.mjs (the installed desktop exe over CDP). The app emits
 * ONE console line, `GUIDON_CAPS <json>`, when #/selftest is opened with
 * ?probe=1 (or window.GUIDON_CAPS_PROBE === true) - see src/app-modules/
 * caps.js and the "Platform capabilities" check in src/index.html. Each
 * collector captures that line and writes it here as
 *   artifacts/caps/<engine>-<device>.json
 * with the metadata tools/caps-matrix.mjs needs to accept or refuse it
 * (X16 rules: loopback, isVirtual, engineOnly, sha ancestry, engine/fork
 * consistency with the file name, age). One writer, so the four collectors
 * cannot drift in the file shape they produce.
 *
 * Nothing here is a hand-copied capability list: the ids come from the
 * payload the app itself printed, which comes from the registry.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SENTINEL = "GUIDON_CAPS ";
export const PROBE_HASH = "#/selftest?probe=1";
export const CAPS_DIR = join("artifacts", "caps");

/** Returns the parsed payload when `text` is a sentinel line, else null. */
export function parseSentinel(text) {
  if (typeof text !== "string" || text.indexOf(SENTINEL) !== 0) return null;
  try { return JSON.parse(text.slice(SENTINEL.length)); } catch (e) { return null; }
}

/**
 * Playwright path: arms a console listener, navigates the already-loaded
 * page to #/selftest?probe=1, and resolves with the parsed payload - or
 * null after `timeoutMs` (a build that predates caps.js never prints one).
 * The listener is removed either way so the caller's own console capture
 * keeps working. The page is left on #/selftest; callers that care navigate
 * back themselves.
 */
export async function probeViaPlaywright(page, { timeoutMs = 8000 } = {}) {
  let resolve;
  const got = new Promise((r) => { resolve = r; });
  const onConsole = (m) => { const p = parseSentinel(m.text()); if (p) resolve(p); };
  page.on("console", onConsole);
  const timer = setTimeout(() => resolve(null), timeoutMs);
  try {
    await page.evaluate((h) => { location.hash = h; }, PROBE_HASH);
    return await got;
  } finally {
    clearTimeout(timer);
    page.off("console", onConsole);
  }
}

/**
 * CDP path (tools/cdp.mjs attachToPage() handles: the Android WebView over
 * adb, the desktop exe's WebView2): same contract as probeViaPlaywright.
 * Runtime.consoleAPICalled carries console.log's first argument as a string
 * value, which is the whole sentinel line. cdp.mjs listeners cannot be
 * removed; the one armed here ignores everything after it has resolved.
 */
export async function probeViaCdp(page, { timeoutMs = 8000 } = {}) {
  let resolve, done = false;
  const got = new Promise((r) => { resolve = (v) => { if (!done) { done = true; r(v); } }; });
  page.onEvent((msg) => {
    if (done || msg.method !== "Runtime.consoleAPICalled") return;
    const a = ((msg.params || {}).args || [])[0];
    const p = parseSentinel(a && a.value);
    if (p) resolve(p);
  });
  const timer = setTimeout(() => resolve(null), timeoutMs);
  try {
    await page.evaluate((h) => { location.hash = h; return true; }, PROBE_HASH);
    return await got;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Writes artifacts/caps/<engine>-<device>.json (or into `dir`). `payload` is
 * the parsed sentinel; the metadata fields are what caps-matrix.mjs reads:
 *   engine     collector label and first token of the file name
 *              ("chromium" | "webkit" | "android" | "webview2" | "ios")
 *   device     second token of the file name (e.g. "web", "iphone-16",
 *              "sm-x518u", "desktop")
 *   loopback   true only for a self-check artifact (a collector talking to
 *              its own fixture) - caps-matrix refuses these outright
 *   isVirtual  Simulator/emulator - kept and labelled, never device evidence
 *   engineOnly the engine without its platform (Playwright WebKit is not
 *              iOS) - kept and labelled, never ship evidence
 * Returns the path written. The file is LF-only, ASCII JSON.
 */
export async function writeProbe({ dir = CAPS_DIR, engine, device, collector, payload, loopback = false, isVirtual, engineOnly = false, note = "" }) {
  if (!/^[a-z0-9]+$/.test(engine)) throw new Error("caps-probe: engine label must be [a-z0-9]+, got " + JSON.stringify(engine));
  const slug = String(device).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("caps-probe: device slug is empty for " + JSON.stringify(device));
  await mkdir(dir, { recursive: true });
  const record = {
    schema: 1,
    collector,
    collectedAt: new Date().toISOString(),
    engine,
    device: slug,
    fork: payload && payload.fork ? payload.fork : null,
    sha: payload && payload.sha ? payload.sha : null,
    loopback: !!loopback,
    isVirtual: typeof isVirtual === "boolean" ? isVirtual : !!(payload && payload.isVirtual),
    engineOnly: !!engineOnly,
    note,
    probe: payload,
  };
  const file = join(dir, engine + "-" + slug + ".json");
  await writeFile(file, JSON.stringify(record, null, 2) + "\n", "utf8");
  return file;
}
