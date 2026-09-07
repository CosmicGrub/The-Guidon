/**
 * One-shot reader for the R3 GAP-B nav-load counter
 * (src-tauri/src/desktop.rs::nav_load_count / NavLoadState).
 *
 * tools/desktop-smoke.ps1's Phase4 R3 check launches guidon.exe with
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port> and
 * calls this script twice against the SAME already-running window - once
 * right after boot, once after sending a real OS-level F5 - then diffs the
 * two counts itself. A counter that lives in the Rust process the webview
 * navigates INSIDE of survives a real reload; anything read from the page's
 * OWN JS state would not (a reload resets it), which is exactly why the
 * existing pixel-diff check has zero discriminating power on this app (a
 * fast, locally-cached, mostly-static SPA reloads pixel-identical to
 * itself).
 *
 * Usage: node tools/nav-probe.mjs <cdp-port> [timeout-ms]
 * Prints exactly one line of JSON to stdout:
 *   {"ok":true,"navLoadCount":N}
 *   {"ok":false,"error":"..."}
 * Exit code 0 on ok:true, 1 otherwise.
 */
import { attachToPage } from "./cdp.mjs";

const port = Number(process.argv[2] || 9222);
const timeoutMs = Number(process.argv[3] || 15000);
const CDP = "http://127.0.0.1:" + port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpUp() {
  try {
    const r = await fetch(CDP + "/json/version", { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function main() {
  const t0 = Date.now();
  while (!(await cdpUp())) {
    if (Date.now() - t0 >= timeoutMs) {
      throw new Error(CDP + "/json/version never answered within " + timeoutMs + " ms");
    }
    await sleep(100);
  }
  const list = await (await fetch(CDP + "/json/list")).json();
  const target = list.find((t) => t.type === "page" && t.url && t.url !== "about:blank");
  if (!target) throw new Error("no app page target on " + CDP + "; targets: " + JSON.stringify(list.map((t) => t.type + " " + t.url)));
  const page = await attachToPage(CDP, (t) => t.url === target.url);
  try {
    const count = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("nav_load_count"));
    if (typeof count !== "number") throw new Error("nav_load_count did not return a number: " + JSON.stringify(count));
    console.log(JSON.stringify({ ok: true, navLoadCount: count }));
  } finally {
    page.close();
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
