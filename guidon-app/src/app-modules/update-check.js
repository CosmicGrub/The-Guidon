/* GUIDON - update-check.js : "Check for updates" on the builds that cannot update themselves (global G.updateCheck)

   Who gets it: the Windows/macOS desktop app, the Android app and the saved
   standalone .html file (G.caps.fork() = tauri | android | standalone). The
   hosted web app / installed PWA keeps its own update prompt (src/pwa.js) and
   the iOS Home-Screen copy is the hosted app, so neither gets this panel.

   What it does, and the only thing it does:
     - Nothing happens until the Soldier taps "Check for updates". No request
       at load, on a timer, on idle, on resume or on a route change.
     - On that tap: ONE plain GET of the repository's public release list
       (api.github.com). No credentials, no custom headers, no cookies, no
       referrer, no retries, 8 second limit, answer thrown away when the screen
       closes (nothing is stored).
     - It then offers ONE button that opens the newest release's file for this
       device through the same tap-to-open link every other external link in the
       app uses. It never downloads or installs anything itself (no new plugin,
       no new permission).

   The repository is a build-time constant: window.GUIDON_UPDATE_REPO, stamped
   by tools/build.mjs. Every URL below is derived from it, and this file never
   spells the repository name out, so the same detector can be pointed at
   another app's releases by changing that one value
   (tools/test-update-detector.mjs holds that).

   Everything that comes back is untrusted: shape-checked, host- and
   path-allowlisted, length-capped, and shown ONLY with textContent (never as
   HTML). An unusable answer is shown as "Could not check", never half-acted on. */
window.G = window.G || {};
(function () {
  "use strict";
  var G = window.G;

  var TIMEOUT_MS = 8000;
  var MAX_BODY = 1024 * 1024;     // 1 MB: refuse anything larger
  var MAX_RELEASES = 30;          // the one page we ask for
  var HOSTS = ["github.com", "api.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
  var SHA_RE = /^sha256:[0-9a-f]{64}$/;
  var REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

  // The fixed per-device file names every release carries (the same names the
  // Share screen already links through /releases/latest/download/).
  var FILES = {
    android: { name: "GUIDON-android.apk", label: "Android app" },
    windows: { name: "GUIDON-windows-setup.exe", label: "Windows installer" },
    mac: { name: "GUIDON-macos-universal.dmg", label: "Mac disk image" },
  };

  function repo() {
    var r = window.GUIDON_UPDATE_REPO;
    return (typeof r === "string" && REPO_RE.test(r)) ? r : "";
  }
  function apiUrl() { return "https://api.github.com/repos/" + repo() + "/releases?per_page=" + MAX_RELEASES; }
  function pathPrefix() { return "/" + repo() + "/"; }
  function releasesPage() { return "https://github.com/" + repo() + "/releases"; }

  /* ------------------------------------------------------------ semver */

  var SEMVER = /^[vV]?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z][0-9A-Za-z.-]{0,39}))?(?:\+[0-9A-Za-z.-]{1,40})?$/;
  function parseSemver(s) {
    if (typeof s !== "string" || s.length > 64) return null;
    var m = SEMVER.exec(s.trim());
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".") : [] };
  }
  function cmpIdent(a, b) {
    var an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
    if (an && bn) return (+a) - (+b);
    if (an) return -1;
    if (bn) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  /** -1 / 0 / 1, or null when either side is not a version. */
  function compareVersions(a, b) {
    var x = typeof a === "string" ? parseSemver(a) : a, y = typeof b === "string" ? parseSemver(b) : b;
    if (!x || !y) return null;
    var keys = ["major", "minor", "patch"];
    for (var i = 0; i < 3; i++) { if (x[keys[i]] !== y[keys[i]]) return x[keys[i]] < y[keys[i]] ? -1 : 1; }
    if (!x.pre.length && !y.pre.length) return 0;
    if (!x.pre.length) return 1;     // 1.2.3 is newer than 1.2.3-rc1
    if (!y.pre.length) return -1;
    for (var j = 0; j < Math.max(x.pre.length, y.pre.length); j++) {
      if (x.pre[j] === undefined) return -1;
      if (y.pre[j] === undefined) return 1;
      var c = cmpIdent(x.pre[j], y.pre[j]);
      if (c) return c < 0 ? -1 : 1;
    }
    return 0;
  }

  /* ------------------------------------------------------- URL allowlist */

  /** A URL the app may ever show as a button: https only, an allowlisted host,
   *  no credentials or port, and (for a release link or a file) a path inside
   *  this repository. Returns the normalized string or "". */
  function safeUrl(u, opts) {
    try {
      if (typeof u !== "string" || u.length > 2048 || u.indexOf("https://") !== 0) return "";
      if (/[\u0000-\u001f\u007f\s\\]/.test(u)) return "";
      var p = new URL(u);
      if (p.protocol !== "https:" || p.username || p.password || p.port) return "";
      if (HOSTS.indexOf(p.hostname) < 0) return "";
      if (opts && opts.repoPath) {
        if (p.hostname !== "github.com") return "";
        if (p.pathname.indexOf(pathPrefix()) !== 0) return "";
      }
      return p.href;
    } catch (e) { return ""; }
  }
  function oneLine(s, max) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function isoDay(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}(T[0-9:.+Z-]{0,32})?$/.test(s)) return "";
    var d = new Date(s);
    return isNaN(d.getTime()) ? "" : s.slice(0, 10);
  }

  /* ----------------------------------------------------- response parsing */

  /** Release list JSON (string or parsed) -> { ok, releases[], rawCount } or { ok:false, reason }.
   *  Drafts dropped, non-version tags ignored, duplicate tags keep the first. */
  function parseReleases(input) {
    var data = input;
    if (typeof input === "string") {
      if (input.length > MAX_BODY) return { ok: false, reason: "size" };
      try { data = JSON.parse(input); } catch (e) { return { ok: false, reason: "shape" }; }
    }
    if (!Array.isArray(data) || data.length > 100) return { ok: false, reason: "shape" };
    var seen = {}, out = [];
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!r || typeof r !== "object" || Array.isArray(r)) continue;
      if (r.draft !== false && r.draft !== undefined) continue;      // drafts (or a non-boolean) never count
      var sv = parseSemver(r.tag_name);
      if (!sv) continue;
      var tag = r.tag_name.trim();
      var version = tag.replace(/^[vV]/, "").replace(/\+.*$/, "");
      if (seen[version]) continue;
      seen[version] = true;
      var assets = {};
      if (Array.isArray(r.assets)) {
        for (var k = 0; k < r.assets.length && k < 100; k++) {
          var a = r.assets[k];
          if (!a || typeof a !== "object" || typeof a.name !== "string" || a.name.length > 200) continue;
          var url = safeUrl(a.browser_download_url, { repoPath: true });
          if (!url) continue;
          if (Object.prototype.hasOwnProperty.call(assets, a.name)) continue;
          assets[a.name] = { url: url, digest: (typeof a.digest === "string" && SHA_RE.test(a.digest)) ? a.digest.slice(7) : "" };
        }
      }
      out.push({
        version: version,
        sv: sv,
        pre: r.prerelease === true || sv.pre.length > 0,
        title: oneLine(r.name, 120),
        date: isoDay(r.published_at),
        url: safeUrl(r.html_url, { repoPath: true }),
        assets: assets,
      });
    }
    return { ok: true, releases: out, rawCount: data.length };
  }

  /** installed version + parsed releases -> what to tell the Soldier. */
  function evaluate(parsed, installed) {
    var inst = parseSemver(installed);
    if (!inst) return { state: "error", reason: "installed" };
    var rel = parsed.releases;
    if (!rel.length) return { state: "error", reason: "shape" };
    var newer = rel.filter(function (r) { return compareVersions(r.sv, inst) > 0; })
      .sort(function (a, b) { return compareVersions(a.sv, b.sv); });
    if (!newer.length) {
      var top = rel.slice().sort(function (a, b) { return compareVersions(b.sv, a.sv); })[0];
      return compareVersions(inst, top.sv) > 0
        ? { state: "ahead", installed: installed, latest: top.version }
        : { state: "current", installed: installed };
    }
    // GitHub returns at most one page: if even its oldest entry is newer than
    // this copy there may be more newer ones behind it.
    var oldestOnPage = rel.slice().sort(function (a, b) { return compareVersions(a.sv, b.sv); })[0];
    var more = parsed.rawCount >= MAX_RELEASES && compareVersions(oldestOnPage.sv, inst) > 0;
    return { state: "newer", installed: installed, newer: newer.slice(-MAX_RELEASES), next: more ? null : newer[0], newest: newer[newer.length - 1], more: more };
  }

  /* ----------------------------------------------------------- platform */

  /** "android" | "windows" | "mac" | "file" | "" - which file this build updates from. */
  function platform() {
    var f = G.caps && G.caps.fork ? G.caps.fork() : "";
    if (f === "android") return "android";
    if (f === "standalone") return "file";
    if (f === "tauri") return /Macintosh|Mac OS X/.test(navigator.userAgent || "") ? "mac" : "windows";
    return "";
  }
  /** Only the builds that cannot update themselves. */
  function available() { return !!repo() && platform() !== ""; }

  /* ------------------------------------------------------------ network */

  var inflight = null;

  async function readCapped(res) {
    var len = Number(res.headers && res.headers.get && res.headers.get("content-length"));
    if (len > MAX_BODY) throw new Error("size");
    if (res.body && res.body.getReader) {
      var reader = res.body.getReader(), chunks = [], total = 0;
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        total += step.value.byteLength;
        if (total > MAX_BODY) { try { reader.cancel(); } catch (e) {} throw new Error("size"); }
        chunks.push(step.value);
      }
      var buf = new Uint8Array(total), off = 0;
      chunks.forEach(function (c) { buf.set(c, off); off += c.byteLength; });
      return new TextDecoder("utf-8").decode(buf);
    }
    var t = await res.text();
    if (t.length > MAX_BODY) throw new Error("size");
    return t;
  }

  /** The ONE request. Resolves to an evaluate() result; never throws. */
  function check() {
    if (inflight) return inflight;
    inflight = (async function () {
      if (!repo()) return { state: "error", reason: "config" };
      try { if (G.netLedger && G.netLedger.record) G.netLedger.record({ kind: "update-check", peer: "api.github.com", at: Date.now() }); } catch (e) {}
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
      var timer2 = 0;
      var timedOut = new Promise(function (_, rej) { timer2 = setTimeout(function () { rej(new Error("timeout")); }, TIMEOUT_MS + 50); });
      try {
        var work = (async function () {
          var res = await fetch(apiUrl(), { method: "GET", cache: "no-store", credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined });
          if (res.url && !safeUrl(res.url)) throw new Error("host");   // a redirect to anywhere off the allowlist
          if (!res.ok) throw new Error("http");
          return await readCapped(res);
        })();
        var text = await Promise.race([work, timedOut]);
        var parsed = parseReleases(text);
        if (!parsed.ok) return { state: "error", reason: parsed.reason };
        return evaluate(parsed, window.GUIDON_APP_VERSION);
      } catch (e) {
        var m = String((e && e.message) || "");
        return { state: "error", reason: /^(size|timeout|http|host)$/.test(m) ? m : (e && e.name === "AbortError" ? "timeout" : "network") };
      } finally { clearTimeout(timer); clearTimeout(timer2); }
    })().finally(function () { inflight = null; });
    return inflight;
  }

  /* ------------------------------------------------------------------ UI */

  var NO_SIGNAL = "Could not check. That is fine: GUIDON works without a signal.";
  var NEXT_STEP = {
    android: "Your device will download the file and ask to install it. Android may first ask you to allow installs from this source. Your study data stays on this device.",
    windows: "Run the downloaded file to update. Your study data stays.",
    mac: "Open the downloaded file to update. Your study data stays.",
    file: "This opens the release page, where you can download the newest GUIDON file. Export a backup first (Profile, Backup & restore): a new copy of the file may not see this copy's saved data.",
  };

  function verLabel(r) { return r.version + (r.pre ? " (pre-release)" : ""); }
  function when(r) { return r.date ? " (released " + r.date + ")" : ""; }

  /** The sentence for the status line. */
  function statusText(res) {
    if (res.state === "current") return "You have the newest version (" + res.installed + ").";
    if (res.state === "ahead") return "This copy (" + res.installed + ") is newer than the newest release listed (" + res.latest + ").";
    if (res.state === "newer") {
      var n = res.newer.length, nw = res.newest;
      if (n === 1 && !res.more) return "Version " + verLabel(nw) + " is available" + when(nw) + ".";
      return (res.more ? "Many newer versions are available. " : n + " newer versions are available. ") + "The newest is " + verLabel(nw) + when(nw) + ".";
    }
    return NO_SIGNAL;
  }

  function buildDetails(res) {
    var d = G.util.el("details", { style: "margin-top:10px" });
    d.appendChild(G.util.el("summary", { text: "Details", style: "cursor:pointer" }));
    var el = G.util.el;
    var ul = el("ul", { style: "margin:8px 0 0 18px" });
    // Newest first reads best; the "Next" tag marks the lowest newer one.
    res.newer.slice().reverse().forEach(function (r) {
      var li = el("li", { style: "margin:5px 0" });
      var tags = [];
      if (res.next && r === res.next && res.newer.length > 1) tags.push("next");
      if (r === res.newest && res.newer.length > 1) tags.push("newest");
      if (r.pre) tags.push("pre-release");
      li.appendChild(el("span", { text: r.version + (tags.length ? " [" + tags.join(", ") + "]" : "") + (r.date ? " · " + r.date : "") + (r.title ? " · " + r.title : "") }));
      var link = r.url || releasesPage();
      li.appendChild(document.createTextNode(" "));
      li.appendChild(el("a", { href: link, target: "_blank", rel: "noopener noreferrer", text: "See what changed" }));
      ul.appendChild(li);
    });
    d.appendChild(ul);
    if (res.more) {
      d.appendChild(el("p.hint", { style: "margin-top:6px" }, [
        "And more: ",
        el("a", { href: releasesPage(), target: "_blank", rel: "noopener noreferrer", text: "see the releases page" }),
        ".",
      ]));
    }
    var pick = res.pick;
    if (pick && pick.digest) {
      d.appendChild(el("p.hint", { style: "margin-top:8px;word-break:break-all" }, [
        "SHA-256 to verify the file (" + pick.name + "): ",
        el("code", { text: pick.digest }),
      ]));
    }
    return d;
  }

  /** The panel: status line + ONE button; everything else under "Details". */
  function renderPanel(mount) {
    if (!available()) return null;
    var el = G.util.el;
    var panel = el("div.panel", { id: "update-check-panel", style: "margin-bottom:12px;border-left:3px solid var(--cyan)" });
    panel.appendChild(el("div.eyebrow", { text: "Updates" }));
    panel.appendChild(el("p", { id: "update-check-installed", text: "Installed: GUIDON " + (window.GUIDON_APP_VERSION || "unknown") + ", built " + (window.GUIDON_BUILD_DATE || "unknown") }));
    var btn = el("button.btn", { type: "button", id: "update-check-btn", text: "Check for updates" });
    var status = el("p", { id: "update-check-status", role: "status", "aria-live": "polite", style: "margin-top:8px" });
    var out = el("div", { id: "update-check-result" });
    panel.appendChild(btn);
    panel.appendChild(status);
    panel.appendChild(out);
    panel.appendChild(el("p.hint", { style: "margin-top:8px", text: "Tapping the button makes one request to GUIDON's public release list on GitHub. Nothing else is sent, and nothing is saved." }));
    btn.addEventListener("click", async function () {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Checking…";
      G.util.clear(out);
      status.textContent = "";
      var res = await check();
      btn.disabled = false;
      btn.textContent = "Check for updates";
      status.textContent = statusText(res);
      if (res.state !== "newer") return;
      var plat = platform();
      var want = FILES[plat];
      var asset = want && res.newest.assets[want.name];
      res.pick = asset ? { name: want.name, digest: asset.digest } : null;
      var href = asset ? asset.url : (res.newest.url || releasesPage());
      out.appendChild(el("a.btn.primary", {
        id: "update-check-go", href: href, target: "_blank", rel: "noopener noreferrer",
        text: "Update to " + res.newest.version, style: "display:block;text-align:center;text-decoration:none;font-size:1.1em;padding:14px 16px;margin-top:8px",
      }));
      if (want && !asset) {
        out.appendChild(el("p.hint", { style: "margin-top:6px", text: "The newest version does not have a " + want.label + " attached yet, so this opens its release page instead." }));
      }
      out.appendChild(el("p.hint", { style: "margin-top:6px", text: NEXT_STEP[plat] || "" }));
      out.appendChild(buildDetails(res));
    });
    mount.appendChild(panel);
    return panel;
  }

  G.updateCheck = {
    available: available,
    check: check,
    renderPanel: renderPanel,
    parseSemver: parseSemver,
    compareVersions: compareVersions,
    parseReleases: parseReleases,
    evaluate: evaluate,
    safeUrl: safeUrl,
    statusText: statusText,
    platform: platform,
    apiUrl: apiUrl,
    TIMEOUT_MS: TIMEOUT_MS,
    MAX_BODY: MAX_BODY,
  };
})();
