/**
 * The in-app "Check for updates" (src/app-modules/update-check.js, G.updateCheck).
 *
 * The promise: on the desktop app, the Android app and the saved standalone file
 * (and ONLY there) one button looks at the repository's public release list, and
 * it does so only when tapped - one plain GET, nothing about the person sent,
 * nothing stored - then offers ONE "Update to <newest>" button that opens the
 * newest release's file for this device. This suite holds every part of that:
 *
 *   1. pure cases: version compare / release-list parsing / evaluation
 *   2. availability per fork (button absent on web, installed PWA and iOS)
 *   3. NO request on load, idle, route changes or resume; exactly ONE per tap
 *   4. the behaviour matrix against stubbed answers (newer, same, older, error,
 *      timeout, 500, malformed, oversize, missing file, 31+ newer, drafts,
 *      pre-releases, duplicates, non-version tags)
 *   5. hostile answers (other hosts, http, javascript:/data: URLs, paths outside
 *      the repository, HTML in names, bad digests) - shown as text or dropped
 *   6. the one repository constant, the CSP position and the request's headers
 *
 * Tap-driven pages are stubbed at the network layer (page.route), so the app's own
 * fetch() really runs; nothing here talks to GitHub. A real, live check of
 * GitHub's CORS answer is recorded in the PR, not made on every CI run.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(pass + " -- " + (fail || "")));

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const SHELLS = {
  web: () => {},
  tauri: () => { window.__TAURI_INTERNALS__ = {}; },
  android: () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} }; },
  ios: () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: {} }; },
  pwa: () => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q));
  },
  iosPwa: () => { Object.defineProperty(navigator, "standalone", { value: true }); },
};

/** A new page in `shell`, every external request recorded and (by default) answered by `answer`. */
async function open(shell, { ua, answer, target = url, ctxOpts } = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1000, height: 900 } }, ua ? { userAgent: ua } : {}, ctxOpts || {}));
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(shell + " " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push(shell + " pageerror: " + e.message));
  const external = [];
  const origin = new URL(target).origin;
  page.on("request", (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (target.startsWith("file:") ? u.startsWith("file:") : u.startsWith(origin)) return;
    external.push({ url: u, method: r.method(), headers: r.headers() });
  });
  await page.route(/^https?:\/\/(?!(127\.0\.0\.1|localhost)[:/])/, async (route) => {
    if (answer) return answer(route);
    return route.abort("failed");
  });
  await page.addInitScript(SHELLS[shell]);
  await page.goto(target, { waitUntil: "load" });
  await dismissOnboarding(page);
  return { page, ctx, external };
}
// Wait for the screen to be drawn (the hash is current and the view has content), not for a fixed time.
const go = async (page, hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction((h) => location.hash === h && (((document.querySelector(".view") || {}).textContent) || "").length > 20, hash, { timeout: 10000 });
  await frame(page);
};
// One animation frame; and an in-page quiet period for the "nothing happens" proofs (a negative can only be shown over time).
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
const quiet = (page, ms) => page.evaluate((n) => new Promise((r) => setTimeout(r, n)), ms);

/* ---------- fixtures ---------- */
const REPO = await (async () => {
  const { page, ctx } = await open("web");
  const r = await page.evaluate(() => window.GUIDON_UPDATE_REPO);
  await ctx.close();
  return r;
})();
const hex = (seed) => { let h = ""; for (let i = 0; h.length < 64; i++) h += ((seed * 2654435761 + i * 40503) >>> 0).toString(16).padStart(8, "0"); return h.slice(0, 64); };
const ALIASES = ["GUIDON-android.apk", "GUIDON-windows-setup.exe", "GUIDON-macos-universal.dmg"];
function rel(tag, o = {}) {
  const n = Number(tag.replace(/\D/g, "").slice(0, 6)) || 1;
  const assets = o.assets || ALIASES.map((name, i) => ({ name, browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}`, digest: "sha256:" + hex(n + i) }));
  return {
    tag_name: tag, name: o.name === undefined ? "GUIDON " + tag : o.name, draft: !!o.draft, prerelease: !!o.pre,
    published_at: o.date || "2026-11-2" + (n % 10) + "T10:00:00Z",
    html_url: o.html_url === undefined ? `https://github.com/${REPO}/releases/tag/${tag}` : o.html_url,
    assets,
  };
}
const ok200 = (body, extra = {}) => (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: typeof body === "string" ? body : JSON.stringify(body), ...extra });

async function tap(page, setVersion = "1.18.1") {
  await page.evaluate((v) => { window.GUIDON_APP_VERSION = v; }, setVersion);
  await page.click("#update-check-btn");
  await page.waitForFunction(() => (document.querySelector("#update-check-status") || {}).textContent, null, { timeout: 12000 });
}
const view = (page) => page.evaluate(() => {
  const p = document.querySelector("#update-check-panel");
  const go = document.querySelector("#update-check-go");
  const d = p && p.querySelector("details");
  return {
    status: document.querySelector("#update-check-status").textContent,
    goText: go && go.textContent, goHref: go && go.getAttribute("href"),
    nextLine: go && go.nextElementSibling && go.nextElementSibling.textContent,
    hint2: [...p.querySelectorAll("p.hint")].map((x) => x.textContent),
    detailsOpen: d ? d.open : null,
    details: d ? d.textContent : "",
    items: d ? [...d.querySelectorAll("li")].map((li) => li.textContent) : [],
    links: [...p.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    address: (p.querySelector("#update-check-address") || {}).textContent || null,
    imgs: p.querySelectorAll("img,script,iframe,svg").length,
    html: p.innerHTML,
    pwned: !!window.__pwned,
  };
});

/* ================================================================== 1. pure */
{
  const { page, ctx } = await open("web");
  const r = await page.evaluate(({ REPO }) => {
    const U = window.G.updateCheck, out = [];
    const t = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) out.push(name + ": got " + JSON.stringify(got) + " want " + JSON.stringify(want)); };
    const c = (a, b) => U.compareVersions(a, b);
    t("newer", c("1.18.2", "1.18.1"), 1); t("equal", c("1.18.1", "1.18.1"), 0); t("older", c("1.17.9", "1.18.0"), -1);
    t("v-prefix", c("v1.19.0", "1.18.1"), 1); t("numeric not lexical", c("1.10.0", "1.9.0"), 1);
    t("prerelease < release", c("1.19.0-rc.1", "1.19.0"), -1); t("rc2 > rc1", c("1.19.0-rc.2", "1.19.0-rc.1"), 1);
    t("rc10 > rc9", c("1.19.0-rc.10", "1.19.0-rc.9"), 1); t("pre of next > release", c("1.19.0-beta", "1.18.1"), 1);
    t("build meta ignored", c("1.2.3+abc", "1.2.3"), 0);
    for (const g of ["", "garbage", "1.2", "1.2.3.4", "v", "1.2.x", "1.2.3-", null, undefined, 7, {}, "1.2.3<script>", "9999999.0.0"]) t("garbage " + JSON.stringify(g), U.parseSemver(g), null);
    t("garbage compare", c("nightly", "1.0.0"), null);
    // evaluate()
    const ev = (list, inst, raw) => U.evaluate({ releases: U.parseReleases(list).releases, rawCount: raw || list.length }, inst);
    const R = (tag, o) => Object.assign({ tag_name: tag, draft: false, prerelease: false, name: "n " + tag, published_at: "2026-11-01T00:00:00Z", html_url: "https://github.com/" + REPO + "/releases/tag/" + tag, assets: [] }, o || {});
    t("same", ev([R("v1.18.1"), R("v1.18.0")], "1.18.1").state, "current");
    t("ahead", ev([R("v1.18.1"), R("v1.18.0")], "1.19.0").state, "ahead");
    const e3 = ev([R("v1.20.0"), R("v1.19.0"), R("v1.18.2"), R("v1.18.1")], "1.18.1");
    t("newer count", e3.newer.map((x) => x.version), ["1.18.2", "1.19.0", "1.20.0"]);
    t("next", e3.next.version, "1.18.2"); t("newest", e3.newest.version, "1.20.0"); t("more false", e3.more, false);
    t("no valid releases", ev([R("nightly")], "1.18.1").state, "error");
    t("installed garbage", U.evaluate({ releases: [], rawCount: 0 }, "x").state, "error");
    t("not an array", U.parseReleases({ a: 1 }).ok, false); t("bad json", U.parseReleases("{nope").ok, false);
    t("huge string", U.parseReleases("[" + " ".repeat(U.MAX_BODY + 5) + "]").reason, "size");
    t("101 entries refused", U.parseReleases(new Array(101).fill(R("v1.0.0"))).ok, false);
    // repo derivation: only the one constant
    window.GUIDON_UPDATE_REPO = "other-org/other-app";
    t("api url derives", U.apiUrl(), "https://api.github.com/repos/other-org/other-app/releases?per_page=30");
    t("path allowlist derives (in)", U.safeUrl("https://github.com/other-org/other-app/releases/tag/v1", { repoPath: true }) !== "", true);
    t("path allowlist derives (old repo out)", U.safeUrl("https://github.com/" + REPO + "/releases/tag/v1", { repoPath: true }), "");
    window.GUIDON_UPDATE_REPO = "not a repo";
    t("bad repo constant disables", U.available(), false);
    window.GUIDON_UPDATE_REPO = REPO;
    // safeUrl table
    const S = (u, o) => U.safeUrl(u, o);
    const good = "https://github.com/" + REPO + "/releases/download/v1/x.apk";
    t("good", S(good, { repoPath: true }), good);
    for (const [n, u] of [["http", "http://github.com/" + REPO + "/x"], ["javascript", "javascript:alert(1)"], ["data", "data:text/html,<b>x</b>"], ["other host", "https://evil.example/" + REPO + "/x"],
      ["lookalike host", "https://github.com.evil.example/" + REPO + "/x"], ["userinfo", "https://a@github.com/" + REPO + "/x"], ["port", "https://github.com:444/" + REPO + "/x"],
      ["outside path", "https://github.com/someone-else/app/releases/x"], ["traversal-ish", "https://github.com/other/" + REPO + "/x"], ["api host for a file", "https://api.github.com/" + REPO + "/x"],
      ["backslash", "https://github.com\\@evil.example/" + REPO + "/x"], ["whitespace", "https://github.com/" + REPO + "/a b"], ["ftp", "ftp://github.com/" + REPO + "/x"], ["not a string", 5]])
      t("reject " + n, S(u, { repoPath: true }), "");
    t("allow-listed non-repo host without path rule", S("https://objects.githubusercontent.com/x") !== "", true);
    t("digest regex: lowercase 64 hex only", [
      U.parseReleases([R("v2.0.0", { assets: [{ name: "a", browser_download_url: good, digest: "sha256:" + "a".repeat(64) }, { name: "b", browser_download_url: good, digest: "sha256:" + "A".repeat(64) },
        { name: "c", browser_download_url: good, digest: "sha256:" + "a".repeat(63) }, { name: "d", browser_download_url: good, digest: "md5:" + "a".repeat(32) }, { name: "e", browser_download_url: good, digest: "sha256:" + "a".repeat(64) + "<b>" }] })]).releases[0].assets
    ].map((a) => Object.keys(a).map((k) => k + "=" + (a[k].digest ? "Y" : "n")).join(",")), ["a=Y,b=n,c=n,d=n,e=n"]);
    return out;
  }, { REPO });
  r.length === 0 ? ok("1. version compare, release-list parsing, evaluation and URL allowlist behave on every pure case") : r.forEach((m) => bad("1. " + m));
  await ctx.close();
}

/* ============================================= 2. availability per fork */
{
  const results = {};
  for (const [name, shell, ua] of [["hosted web", "web"], ["installed PWA", "pwa"], ["iOS Home-Screen PWA", "iosPwa", IOS_UA], ["iOS Capacitor", "ios", IOS_UA], ["desktop (Tauri)", "tauri"], ["Android (Capacitor)", "android"]]) {
    const { page, ctx } = await open(shell, { ua });
    const per = {};
    for (const h of ["#/share", "#/settings"]) {
      await go(page, h);
      per[h] = await page.evaluate(() => ({ panel: !!document.querySelector("#update-check-panel"), btn: !!document.querySelector("#update-check-btn"), fork: G.caps.fork(), available: G.updateCheck.available(),
        first: [...(document.querySelector(".view .section-title") || { parentElement: { children: [] } }).parentElement.children].findIndex((c) => c.id === "update-check-panel") }));
    }
    results[name] = per;
    await ctx.close();
  }
  for (const n of ["hosted web", "installed PWA", "iOS Home-Screen PWA", "iOS Capacitor"]) {
    const r = results[n];
    check(!r["#/share"].panel && !r["#/settings"].panel && !r["#/share"].available, `2. no update button on ${n} (fork ${r["#/share"].fork})`, JSON.stringify(r));
  }
  for (const n of ["desktop (Tauri)", "Android (Capacitor)"]) {
    const r = results[n];
    check(r["#/share"].btn && r["#/settings"].btn, `2. the Check for updates button is on Share & Install and Settings About on ${n} (fork ${r["#/share"].fork})`, JSON.stringify(r));
  }
  check(results["desktop (Tauri)"]["#/share"].first >= 0 && results["desktop (Tauri)"]["#/share"].first <= 2, "2. on Share & Install the update panel sits at the very top (right after the title and the app's own install-status strip)", JSON.stringify(results["desktop (Tauri)"]["#/share"]));
  // standalone file
  const dist = resolve("dist/guidon-standalone.html");
  const st = await stat(dist).catch(() => null);
  if (!st) bad("2. dist/guidon-standalone.html is missing - run npm run build");
  else {
    const { page, ctx } = await open("web", { target: pathToFileURL(dist).href });
    const per = {};
    for (const h of ["#/share", "#/settings"]) { await go(page, h); per[h] = await page.evaluate(() => ({ btn: !!document.querySelector("#update-check-btn"), fork: G.caps.fork(), plat: G.updateCheck.platform() })); }
    check(per["#/share"].btn && per["#/settings"].btn && per["#/share"].fork === "standalone" && per["#/share"].plat === "file", "2. the button is on the saved standalone file (file://) too, on both screens", JSON.stringify(per));
    await ctx.close();
  }
  const { page, ctx } = await open("tauri");
  await go(page, "#/share");
  const txt = await page.evaluate(() => document.querySelector(".view").textContent);
  check(!/no in-app updater/i.test(txt) && /Installed: GUIDON \S+, built \S+/.test(txt), "2. Share & Install shows 'Installed: GUIDON <version>, built <date>' and no longer says there is no updater", txt.slice(0, 200));
  await ctx.close();
}

/* ============================== 3. nothing on load/idle/route/resume; one per tap */
{
  const { page, ctx, external } = await open("tauri", { answer: ok200([rel("v1.18.1")]) });
  const routes = await page.evaluate(() => G.routes.map((r) => r.hash));
  for (const h of routes.slice(0, 60)) { await page.evaluate((x) => { location.hash = x; }, h); await frame(page); }
  await go(page, "#/share"); await go(page, "#/settings"); await go(page, "#/home");
  await quiet(page, 1500);
  await page.evaluate(() => { for (const t of ["visibilitychange", "focus", "online", "pageshow", "resume"]) { window.dispatchEvent(new Event(t)); document.dispatchEvent(new Event(t)); } });
  await quiet(page, 500);
  const quietLedger = await page.evaluate(() => G.netLedger.list().length);
  check(external.length === 0 && quietLedger === 0, `3. NO request and no ledger entry on load, idle, ${Math.min(routes.length, 60)} route changes or resume events`, JSON.stringify(external.map((e) => e.url)) + " ledger " + quietLedger);
  await go(page, "#/share");
  await page.evaluate(() => { window.GUIDON_APP_VERSION = "1.18.1"; });
  // everything the app keeps on the device, before and after the tap
  const stored = () => page.evaluate(async () => {
    const local = Object.keys(localStorage).sort().map((k) => k + "=" + localStorage.getItem(k));
    const rows = await G.db.all("kv");
    return JSON.stringify({ local, kv: rows.map((r) => r.k).sort(), session: Object.keys(sessionStorage).sort(), cookie: document.cookie });
  });
  await quiet(page, 500);
  const before = await stored();
  // a double tap must still be one request
  await page.evaluate(() => { const b = document.querySelector("#update-check-btn"); b.click(); b.click(); });
  await page.waitForFunction(() => (document.querySelector("#update-check-status") || {}).textContent, null, { timeout: 8000 });
  await quiet(page, 500);
  const led = await page.evaluate(() => G.netLedger.list());
  check(external.length === 1 && external[0].method === "GET" && /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\?per_page=30$/.test(external[0].url), "3. exactly ONE request after a tap (even a double tap): a GET of the release list", JSON.stringify(external.map((e) => e.method + " " + e.url)));
  check(led.length === 1 && led[0].kind === "update-check" && led[0].peer === "api.github.com", "3. the tap is recorded in the network ledger as kind 'update-check'", JSON.stringify(led));
  const hdrs = Object.keys(external[0].headers || {});
  check(!hdrs.some((h) => /^(authorization|cookie|x-|proxy-|if-)/i.test(h)) && !("referer" in external[0].headers), "3. the request carries no credentials, cookie, token, custom header or referrer", JSON.stringify(external[0].headers));
  const diag = await page.evaluate(async () => { const t = G.selftest && G.selftest.AUTO ? G.selftest.AUTO.find((c) => c.id === "offline") : null; return t ? await t.run() : null; });
  if (diag) check(diag.ok && /1 update check you tapped/.test(diag.detail), "3. Diagnostics 'No external requests' still passes after a tap and reports the tapped check on its own line", JSON.stringify(diag));
  await quiet(page, 1500);
  const after = await stored();
  check(after === before && !/1\.18\.1\/|releases\/tag/.test(after), "3. nothing from the answer is saved: on-device storage is unchanged by a check", before.slice(0, 300) + " -> " + after.slice(0, 300));
  check(external.length === 1, "3. still only one request a while later (no retry, no timer)", String(external.length));
  await ctx.close();
}

/* ===================================================== 4. behaviour matrix */
async function scenario(shell, answer, opts = {}) {
  const { page, ctx, external } = await open(shell, { answer, ua: opts.ua });
  await go(page, "#/share");
  if (opts.beforeTap) await opts.beforeTap(page);
  await tap(page, opts.installed || "1.18.1");
  if (opts.afterTap) await opts.afterTap(page);
  const v = await view(page);
  return { page, ctx, external, v };
}
const NO_SIGNAL = "Could not check. That is fine: GUIDON works without a signal.";
const GOOD_HOST = new RegExp("^https://github\\.com/" + REPO.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "/");
{
  // newer: several releases, Android
  const list = [rel("v1.20.0", { name: "Big one" }), rel("v1.19.0", { name: "Middle" }), rel("v1.19.0-rc.1", { pre: true, name: "Candidate" }), rel("v1.18.2", { name: "Small fix" }), rel("v1.18.1"), rel("v1.18.0")];
  const { ctx, v } = await scenario("android", ok200(list));
  check(/^3 newer versions are available\. The newest is 1\.20\.0 \(released 2026-11-\d\d\)\.$/.test(v.status) || /^4 newer versions are available\./.test(v.status), "4. several newer releases: the status line counts them and names the newest", v.status);
  check(v.goText === "Update to 1.20.0" && v.goHref === `https://github.com/${REPO}/releases/download/v1.20.0/GUIDON-android.apk`, "4. ONE big button 'Update to <newest>' opens the NEWEST release's Android file", v.goText + " -> " + v.goHref);
  check(/Your device will download the file and ask to install it\..*allow installs from this source.*Your study data stays on this device\./.test(v.nextLine), "4. one plain line under the button says what happens next (Android)", v.nextLine);
  check(v.detailsOpen === false && v.items.length === 4, "4. the list of every newer release is under a collapsed 'Details'", JSON.stringify(v.items));
  check(/^1\.18\.2 \[next\]/.test(v.items[v.items.length - 1]) && /^1\.20\.0 \[newest\]/.test(v.items[0]), "4. the lowest newer release is marked 'next' and the highest 'newest'", JSON.stringify(v.items));
  check(v.items.some((i) => /^1\.19\.0-rc\.1 \[pre-release\]/.test(i)) && /Candidate/.test(v.details), "4. a pre-release is labelled 'pre-release' with its title", JSON.stringify(v.items));
  check(new RegExp("SHA-256 to verify the file \\(GUIDON-android\\.apk\\): [0-9a-f]{64}").test(v.details), "4. the file's SHA-256 is shown for verification", v.details);
  check(v.links.every((l) => GOOD_HOST.test(l)) && v.links.length >= 4, "4. every link in the panel is https, github.com and inside the repository", JSON.stringify(v.links));
  await ctx.close();
}
{
  const r = await scenario("tauri", ok200([rel("v1.18.2", { name: "Only one" }), rel("v1.18.1")]));
  check(/^Version 1\.18\.2 is available \(released 2026-11-\d\d\)\.$/.test(r.v.status), "4. one newer release: 'Version X is available (released <date>).'", r.v.status);
  check(r.v.goHref.endsWith("/v1.18.2/GUIDON-windows-setup.exe") && /^Run the downloaded file to update\. Your study data stays\.$/.test(r.v.nextLine), "4. Windows: the button opens the Windows installer, with the Windows 'what happens next' line", r.v.goHref + " | " + r.v.nextLine);
  check(r.v.items.length === 1 && !/\[/.test(r.v.items[0]), "4. a single newer release is not tagged next/newest", JSON.stringify(r.v.items));
  check(r.v.hint2.some((h) => h.startsWith("If nothing opens, type this address into a browser:")) && r.v.address === r.v.goHref, "4. desktop: the download address is also shown as text to type, because a link tap is not proven on the desktop shell", r.v.address);
  await r.ctx.close();
  const m = await scenario("tauri", ok200([rel("v1.18.2"), rel("v1.18.1")]), { ua: MAC_UA });
  check(m.v.goHref.endsWith("/v1.18.2/GUIDON-macos-universal.dmg"), "4. Mac desktop: the button opens the Mac disk image", m.v.goHref);
  await m.ctx.close();
  const f = await open("web", { target: pathToFileURL(resolve("dist/guidon-standalone.html")).href, answer: ok200([rel("v1.18.2"), rel("v1.18.1")]) });
  await go(f.page, "#/share"); await tap(f.page);
  const fv = await view(f.page);
  check(fv.goText === "Update to 1.18.2" && fv.goHref === `https://github.com/${REPO}/releases/tag/v1.18.2` && /Export a backup first/.test(fv.nextLine), "4. standalone file: the button opens the release page (no file for a saved page) and says to export a backup first", fv.goHref + " | " + fv.nextLine);
  await f.ctx.close();
}
{
  let r = await scenario("android", ok200([rel("v1.18.1"), rel("v1.18.0")]));
  check(r.v.status === "You have the newest version (1.18.1).", "4. same version: 'You have the newest version (1.18.1).'", r.v.status);
  check(r.v.goText === null, "4. same version: no update button", String(r.v.goText)); await r.ctx.close();
  r = await scenario("android", ok200([rel("v1.18.1"), rel("v1.18.0")]), { installed: "1.19.0" });
  check(/^This copy \(1\.19\.0\) is newer than the newest release listed \(1\.18\.1\)\.$/.test(r.v.status) && r.v.goText === null, "4. older release list: 'ahead of Latest', no button", r.v.status); await r.ctx.close();
  r = await scenario("android", (route) => route.abort("failed"));
  check(r.v.status === NO_SIGNAL && r.v.goText === null, "4. network error: the plain 'Could not check' line", r.v.status); await r.ctx.close();
  r = await scenario("android", (route) => route.fulfill({ status: 500, body: "boom", headers: { "access-control-allow-origin": "*" } }));
  check(r.v.status === NO_SIGNAL, "4. HTTP 500: the plain 'Could not check' line", r.v.status); await r.ctx.close();
  r = await scenario("android", ok200("{ not json"));
  check(r.v.status === NO_SIGNAL, "4. malformed JSON: the plain 'Could not check' line", r.v.status); await r.ctx.close();
  r = await scenario("android", ok200({ tag_name: "v9.9.9" }));
  check(r.v.status === NO_SIGNAL && r.v.goText === null, "4. wrong JSON shape (an object, not a list): 'Could not check'", r.v.status); await r.ctx.close();
  r = await scenario("android", ok200("[" + '{"tag_name":"v9.9.9","name":"' + "x".repeat(1100000) + '"}' + "]"));
  check(r.v.status === NO_SIGNAL && r.v.goText === null, "4. an answer over 1 MB is refused", r.v.status); await r.ctx.close();
  r = await scenario("android", ok200([rel("nightly"), rel("v1.2"), rel("latest")]));
  check(r.v.status === NO_SIGNAL, "4. a list with no usable version tag: 'Could not check'", r.v.status); await r.ctx.close();
  // missing file for this device
  r = await scenario("android", ok200([rel("v1.19.0", { assets: [{ name: "GUIDON-windows-setup.exe", browser_download_url: `https://github.com/${REPO}/releases/download/v1.19.0/GUIDON-windows-setup.exe`, digest: null }] }), rel("v1.18.1")]));
  check(r.v.goHref === `https://github.com/${REPO}/releases/tag/v1.19.0` && /does not have a Android app attached yet/.test(r.v.hint2.join(" ")) && !/SHA-256/.test(r.v.details), "4. missing file for this device: the button opens the release page instead, with an honest line, no SHA-256", r.v.goHref + " | " + r.v.hint2.join(" ")); await r.ctx.close();
  // drafts, duplicates, non-version tags
  r = await scenario("android", ok200([rel("v9.9.9", { draft: true }), rel("v1.19.0"), rel("v1.19.0", { name: "DUPLICATE" }), rel("nightly"), rel("v1.18.1")]));
  check(/^Version 1\.19\.0 is available/.test(r.v.status) && r.v.items.length === 1 && !/DUPLICATE/.test(r.v.details) && !/9\.9\.9/.test(r.v.html), "4. drafts are dropped, a duplicate tag counts once (first wins), non-version tags are ignored", r.v.status + JSON.stringify(r.v.items)); await r.ctx.close();
  // pre-release newest
  r = await scenario("android", ok200([rel("v1.19.0-rc.1", { pre: true }), rel("v1.18.1")]));
  check(/\(pre-release\)/.test(r.v.status) && r.v.goText === "Update to 1.19.0-rc.1", "4. a pre-release that is the newest is labelled clearly in the status line", r.v.status); await r.ctx.close();
  // 30 newer on one full page => "and more"
  const many = []; for (let i = 30; i >= 1; i--) many.push(rel("v1.19." + i));
  r = await scenario("android", ok200(many));
  check(/^Many newer versions are available\. The newest is 1\.19\.30/.test(r.v.status) && r.v.items.length === 30 && /And more: see the releases page/.test(r.v.details) && !r.v.items.some((i) => /\[next\]/.test(i)), "4. when a full page of 30 are all newer: lists 30, says 'And more: see the releases page', and does not claim a 'next'", r.v.status + " items " + r.v.items.length); await r.ctx.close();
  const U40 = []; for (let i = 40; i >= 1; i--) U40.push(rel("v1.19." + i));
  r = await scenario("android", ok200(U40));
  check(/^Many newer versions/.test(r.v.status) && r.v.items.length === 30, "4. a longer answer than 30 is still capped at 30 shown", r.v.status + " items " + r.v.items.length); await r.ctx.close();
  // timeout (8 s) with a request that never answers
  const T = await open("android", { answer: () => new Promise(() => {}) });
  await go(T.page, "#/share");
  await T.page.evaluate(() => { window.GUIDON_APP_VERSION = "1.18.1"; });
  await T.page.clock.install();
  await T.page.click("#update-check-btn");
  await T.page.waitForFunction(() => document.querySelector("#update-check-btn").disabled, null, { timeout: 5000 });
  await T.page.clock.fastForward(7000);
  const pending = await T.page.evaluate(() => document.querySelector("#update-check-status").textContent);
  await T.page.clock.fastForward(1500);
  await T.page.waitForFunction(() => document.querySelector("#update-check-status").textContent, null, { timeout: 5000 });
  const tv = await view(T.page);
  check(pending === "" && tv.status === NO_SIGNAL && T.external.length === 1, "4. no answer: still waiting at 7 s, 'Could not check' after the 8 s limit, still one request (no retry)", `pending="${pending}" status="${tv.status}" requests ${T.external.length}`);
  const btnBack = await T.page.evaluate(() => { const b = document.querySelector("#update-check-btn"); return !b.disabled && b.textContent; });
  check(btnBack === "Check for updates", "4. the button is usable again after a failed check", String(btnBack));
  await T.ctx.close();
}

/* ============================================================ 5. hostile */
{
  const evil = [
    rel("v1.19.5", { name: '<img src=x onerror="window.__pwned=1">Fix <b>bold</b>', html_url: "javascript:alert(1)",
      assets: [{ name: "GUIDON-android.apk", browser_download_url: "https://evil.example/" + REPO + "/releases/download/v1.19.5/GUIDON-android.apk", digest: "sha256:" + "b".repeat(64) }] }),
    rel("v1.19.4", { html_url: "data:text/html,<script>window.__pwned=1</script>", name: "<script>window.__pwned=1</script>" }),
    rel("v1.19.3", { html_url: "http://github.com/" + REPO + "/releases/tag/v1.19.3" }),
    rel("v1.19.2", { html_url: "https://github.com/someone-else/app/releases/tag/v1.19.2" }),
    rel("v1.19.1<img src=x onerror=window.__pwned=1>"),
    rel("v1.19.0", { name: "line one\nline two‮", assets: [{ name: "GUIDON-android.apk", browser_download_url: `https://github.com/${REPO}/releases/download/v1.19.0/GUIDON-android.apk`, digest: "sha256:" + "C".repeat(64) }] }),
  ];
  const r = await scenario("android", ok200(evil));
  check(!r.v.pwned && r.v.imgs === 0, "5. HTML in names and tags is shown as text: nothing runs, no element is created", `pwned=${r.v.pwned} imgs=${r.v.imgs}`);
  check(/<img src=x/.test(r.v.details) && !/<img/i.test(r.v.html.replace(/&lt;img/g, "")), "5. the hostile name appears only as escaped text", r.v.details.slice(0, 160));
  check(r.v.links.every((l) => GOOD_HOST.test(l)), "5. javascript:, data:, http:, other-host and outside-repository addresses never become a link (the releases page is used instead)", JSON.stringify(r.v.links));
  check(r.v.goHref === `https://github.com/${REPO}/releases/tag/v1.19.5` || r.v.goHref === `https://github.com/${REPO}/releases`, "5. a file address on another host is dropped: the button falls back to the repository's release page", r.v.goHref);
  check(!/1\.19\.1/.test(r.v.details), "5. a tag with markup in it is not a version and is ignored", r.v.details.slice(0, 200));
  check(!/[b]{64}|[C]{64}|[c]{64}/.test(r.v.details), "5. a digest from a file that was dropped, or in uppercase, is never shown", r.v.details);
  check(!/‮|line one\nline two/.test(r.v.details), "5. control and bidi characters in a title are flattened", JSON.stringify(r.v.items[r.v.items.length - 1]));
  await r.ctx.close();
  const d = await scenario("android", ok200([rel("v1.19.0"), rel("v1.18.1")]));
  check(/SHA-256 to verify the file \(GUIDON-android\.apk\): [0-9a-f]{64}/.test(d.v.details), "5. a well-formed 'sha256:' digest is shown as 'SHA-256 to verify the file'", d.v.details);
  await d.ctx.close();
  const nd = await scenario("android", ok200([rel("v1.19.0", { assets: [{ name: "GUIDON-android.apk", browser_download_url: `https://github.com/${REPO}/releases/download/v1.19.0/GUIDON-android.apk` }] }), rel("v1.18.1")]));
  check(!/SHA-256/.test(nd.v.details) && nd.v.goText === "Update to 1.19.0", "5. no digest from GitHub: nothing is shown or invented, the button still works", nd.v.details);
  await nd.ctx.close();
}

/* =========================== 6. the repo constant, CSP position, redirects */
{
  const src = await readFile(join("src", "app-modules", "update-check.js"), "utf8");
  const build = await readFile(join("tools", "build.mjs"), "utf8");
  const webHtml = await readFile(join("web", "index.html"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  check(!/CosmicGrub|The-Guidon|github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]/.test(src), "6. the update code never spells the repository out: it is derived from GUIDON_UPDATE_REPO alone", (src.match(/CosmicGrub|The-Guidon/g) || []).join(","));
  check((build.match(/CosmicGrub\/The-Guidon/g) || []).length === 1 && /GUIDON_UPDATE_REPO/.test(build), "6. tools/build.mjs defines the repository exactly once and stamps it into every build", String((build.match(/CosmicGrub\/The-Guidon/g) || []).length));
  check((webHtml.match(/window\.GUIDON_UPDATE_REPO = "[^"]+";/g) || []).length === 1 && webHtml.includes(`window.GUIDON_UPDATE_REPO = "${REPO}";`), "6. every build carries the constant (web/index.html checked here, the standalone file is exercised above)", "");
  check(/fetch\(apiUrl\(\), \{ method: "GET", cache: "no-store", credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer", signal/.test(code) && !/headers\s*:/.test(code) && (code.match(/\bfetch\s*\(/g) || []).length === 1 && !/XMLHttpRequest|sendBeacon|WebSocket|setInterval|visibilitychange|addEventListener\("(online|focus|pageshow|resume)/.test(code), "6. the code makes exactly one fetch: GET, no-store, no credentials, no referrer, no custom headers, and has no timer, resume or retry hook", "");
  check(!/eval\(|new Function|innerHTML|insertAdjacentHTML|document\.write|\bhtml\s*:/.test(code), "6. the update code never evaluates anything and never sets HTML", "");

  // CSP: no build ships one, and the hosted app's strict self-hoster policy is unchanged
  const tauri = JSON.parse(await readFile(join("src-tauri", "tauri.conf.json"), "utf8"));
  const cap = JSON.parse(await readFile("capacitor.config.json", "utf8"));
  check(!(tauri.app && tauri.app.security && tauri.app.security.csp) && !(tauri.tauri && tauri.tauri.security) && !JSON.stringify(cap).includes("connect-src") && !/<meta[^>]+Content-Security-Policy/i.test(webHtml), "6. no build ships a CSP of its own (desktop, Android, hosted, standalone), so there is nothing to widen for api.github.com", "");
  const csp = (connect) => ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src " + connect, "object-src 'none'", "base-uri 'self'"].join("; ");
  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
  async function withCsp(connect, fn) {
    const srv = createServer(async (req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
      const f = join("web", normalize(p).replace(/^(\.\.[/\\])+/, ""));
      const s = await stat(f).catch(() => null);
      if (!s || !s.isFile()) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "content-type": MIME[extname(f).toLowerCase()] || "application/octet-stream", "content-security-policy": csp(connect) });
      res.end(await readFile(f));
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    try { await fn("http://127.0.0.1:" + srv.address().port + "/"); } finally { srv.close(); }
  }
  for (const [connect, wantOk] of [["'self' https://api.github.com", true], ["'self'", false]]) {
    await withCsp(connect, async (target) => {
      const { page, ctx } = await open("tauri", { target, answer: ok200([rel("v1.18.2"), rel("v1.18.1")]) });
      const viol = [];
      await page.evaluate(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI)); });
      await go(page, "#/share"); await tap(page);
      const v = await view(page); const csp2 = await page.evaluate(() => window.__csp);
      if (wantOk) check(/^Version 1\.18\.2 is available/.test(v.status) && csp2.length === 0, "6. under a strict policy that lists api.github.com in connect-src, the check works with no violation", v.status + JSON.stringify(csp2));
      else check(v.status === NO_SIGNAL, "6. under connect-src 'self' alone (the hosted app's strict self-hoster policy) the request is blocked and the screen says 'Could not check' - which is why the hosted app has no button", v.status + JSON.stringify(csp2));
      void viol; await ctx.close();
    });
  }
  // a redirect to a host off the allowlist is refused
  {
    const { page, ctx } = await open("android", { answer: (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify([rel("v1.19.0")]) }) });
    await go(page, "#/share");
    const r = await page.evaluate(async () => {
      const real = window.fetch;
      window.fetch = async (...a) => { const res = await real(...a); return new Proxy(res, { get: (t, k) => (k === "url" ? "https://evil.example/x" : (typeof t[k] === "function" ? t[k].bind(t) : t[k])) }); };
      window.GUIDON_APP_VERSION = "1.18.1";
      const out = await G.updateCheck.check();
      window.fetch = real;
      return out;
    });
    check(r.state === "error" && r.reason === "host", "6. an answer that ended up on a host outside the allowlist is refused", JSON.stringify(r));
    await ctx.close();
  }
}

/* ================================================================== done */
const bleed = noise.filter((n) => !/Failed to load resource|net::ERR_FAILED|blocked by CSP|Content Security Policy|Refused to connect|violates the following/i.test(n));
bleed.length === 0 ? ok("no unexpected console errors or page errors") : bad("console noise: " + bleed.slice(0, 5).join(" | "));
await browser.close();
server.close();
console.log(fails ? `\nupdate-detector: ${fails} FAILURE(S)` : "\nupdate-detector: all checks passed");
process.exit(fails ? 1 : 0);
