/**
 * Cross-engine harness (collective P3b, X4): the ONE place a GUIDON suite
 * may hold a Chromium and a WebKit at the same time. Not a suite itself:
 * tools/test-room-xeng.mjs (host in one engine, joiner in the other, frames
 * relayed by the test process at the room module's transport seam) and
 * tools/test-room-server.mjs (one engine at a time, in sequence) import it.
 * tools/lint-ci-matrix.mjs counts launch( calls per tools/test-*.mjs file;
 * the two launches live HERE so every suite stays at zero.
 *
 * Playwright WebKit on this laptop (webkit-2336): no RTCPeerConnection, no
 * longtask observer - nothing here assumes either. Its executable may be
 * absent on a CI runner that installed Chromium only (ci.yml does exactly
 * that): webkitAvailable() answers that honestly so a suite can SKIP the
 * WebKit half aloud instead of failing on a missing binary.
 *
 * Exports:
 *   ENGINE_NAMES          ["chromium", "webkit"]
 *   webkitAvailable()     true when Playwright's WebKit executable exists
 *   launchEngine(name)    launches one engine (tracked; closeEngines()
 *                         closes every tracked browser)
 *   closeEngines()
 *   openXeng(url, opts)   host page in opts.hostEngine (default chromium),
 *                         joiner page in the OTHER engine, both booted past
 *                         onboarding at opts.hash (default "#/group") with
 *                         the study-groups switch ON. Two browsers, two
 *                         contexts, two IndexedDBs - the closest thing to
 *                         iOS-with-Android this laptop can run. Returns
 *                         { host, joiner, hostEngine, joinerEngine, noise:
 *                         { host: [], joiner: [] }, browsers }.
 *   closeXeng()           closes both and clears the guard.
 */
import { existsSync } from "node:fs";
import { chromium, webkit } from "playwright";
import { bootPage } from "./room-harness.mjs";

export const ENGINE_NAMES = ["chromium", "webkit"];
const ENGINES = { chromium, webkit };
const DEFAULT_VIEWPORT = { width: 1280, height: 880 };
let tracked = [];
let live = null;

export function webkitAvailable() {
  try { return existsSync(webkit.executablePath()); } catch (e) { return false; }
}

export async function launchEngine(name) {
  const eng = ENGINES[name];
  if (!eng) throw new Error("xeng-harness: unknown engine " + name);
  const browser = await eng.launch();
  tracked.push(browser);
  return browser;
}

export async function closeEngines() {
  const list = tracked;
  tracked = [];
  for (const b of list) await b.close().catch(() => {});
}

export async function openXeng(url, opts = {}) {
  if (live) throw new Error("xeng-harness: openXeng() called while a pair is already open - call closeXeng() first");
  live = { browsers: [] };
  const hostEngine = opts.hostEngine === "webkit" ? "webkit" : "chromium";
  const joinerEngine = hostEngine === "chromium" ? "webkit" : "chromium";
  const browsers = [];
  try {
    const hb = await launchEngine(hostEngine); browsers.push(hb);
    const jb = await launchEngine(joinerEngine); browsers.push(jb);
    const hc = await hb.newContext({ viewport: opts.viewport || DEFAULT_VIEWPORT });
    const jc = await jb.newContext({ viewport: opts.viewport || DEFAULT_VIEWPORT });
    const h = await bootPage(hc, url, opts.hash || "#/group", 8000);
    await h.page.evaluate(async () => { await G.store.setSetting("studyGroups", true); });
    const j = await bootPage(jc, url, opts.hash || "#/group", 8000);
    await j.page.evaluate(async () => { await G.store.setSetting("studyGroups", true); });
    await h.page.waitForTimeout(600);
    for (const p of [h.page, j.page]) await p.evaluate(async () => { await G.store.setSetting("studyGroups", true); });
    await h.page.waitForTimeout(300);
    live = { host: h.page, joiner: j.page, hostEngine, joinerEngine, noise: { host: h.noise, joiner: j.noise }, browsers };
    return live;
  } catch (e) {
    for (const b of browsers) await b.close().catch(() => {});
    tracked = tracked.filter((b) => !browsers.includes(b));
    live = null;
    throw e;
  }
}

export async function closeXeng() {
  if (!live) return;
  const bs = live.browsers || [];
  live = null;
  for (const b of bs) await b.close().catch(() => {});
  tracked = tracked.filter((b) => !bs.includes(b));
}
