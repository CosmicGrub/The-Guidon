/**
 * "This copy is about N days old" - the quiet line on a copy that cannot update itself
 *
 * WHY THIS SUITE EXISTS: an installed Android app, the Windows installer and a
 * saved .html file have no updater, and the app never goes online by itself, so
 * nothing ever told a Soldier that the copy in their pocket had aged while newer
 * ones were published. G.currency.buildAgeNote() now says so - once the copy is
 * old enough to matter, on Settings > About, #/currency and #/share (the
 * installed app's own page and a saved file's), never on the hosted web app
 * (which has its own "new version ready" notice).
 *
 * The line is worked out from the build date and the device's own clock, so the
 * clock is faked here (the page believes it is N days after its own build date).
 * Both directions are checked: the line appears when it should AND stays away
 * when it should - a young copy, the hosted app, a date or clock that cannot be
 * trusted (a clock set before the build, a copy "older" than any real one, a
 * build date that is not a date) - because a false "your copy is old" is its own
 * kind of wrong. The link only exists where a tap is known to work (the Android
 * app, a saved file); the Windows app gets the address to copy instead. The line
 * saves nothing and asks nothing, and nothing leaves the origin.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bootApp, check, finish, waitForRoute, until, expectNoConsoleNoise } from "./testkit.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const RELEASES_LATEST = "https://github.com/CosmicGrub/The-Guidon/releases/latest";
const NOTE = ".build-age-note";

// The build date the app itself reports (stamped by the build), read from the built file.
const built = /window\.GUIDON_BUILD_DATE = "(\d{4})-(\d{2})-(\d{2})"/.exec(readFileSync(path.join(APP, "web", "index.html"), "utf8"));
if (!built) throw new Error("test-build-age: no GUIDON_BUILD_DATE in web/index.html - build first");
const dayAfterBuild = (n) => new Date(Date.UTC(+built[1], +built[2] - 1, +built[3] + n, 12, 0, 0));

const ANDROID = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} }; };
const TAURI = () => { window.__TAURI_INTERNALS__ = {}; };
// A build date that is not a date: the page's own assignment must not be able to overwrite it.
const UNKNOWN_DATE = () => { Object.defineProperty(window, "GUIDON_BUILD_DATE", { get() { return "unknown"; }, set() {}, configurable: true }); };

const requests = []; // every request any session makes
const boot = await bootApp({
  viewport: { width: 412, height: 915 },
  contextOptions: { timezoneId: "UTC" },
  beforeLoad: async ({ page, context }) => { await context.clock.setFixedTime(dayAfterBuild(400)); watch(page); },
});
const { noise } = boot;
const origins = new Set([new URL(boot.url).origin]); // the app's own local addresses
function watch(page) { page.on("request", (r) => requests.push(r.url())); }

/** What the three screens show about this copy's age. */
async function notes(page, only = ["about", "currency", "share"]) {
  const out = {};
  for (const [name, hash, ready] of [["about", "#/settings", ".fin-h"], ["currency", "#/currency", ".card-results-grid"], ["share", "#/share", ".eyebrow, .feedback"]].filter((r) => only.includes(r[0]))) {
    await waitForRoute(page, hash, { ready });
    out[name] = await page.evaluate((sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const probe = document.createElement("span");
      probe.style.color = "var(--amber)";
      document.body.appendChild(probe);
      const amber = getComputedStyle(probe).color;
      probe.remove();
      const a = n.querySelector("a");
      return {
        text: n.textContent,
        days: n.getAttribute("data-days"),
        amber: getComputedStyle(n).borderLeftColor === amber,
        href: a ? a.getAttribute("href") : null,
        target: a ? a.getAttribute("target") : null,
        rel: a ? a.getAttribute("rel") : null,
        buttons: n.querySelectorAll("button").length,
        modal: !!document.querySelector("[role=dialog]"),
      };
    }, NOTE);
  }
  return out;
}
const all = (n, f) => Object.keys(n).every((k) => n[k] && f(n[k]));
const none = (n) => Object.keys(n).every((k) => n[k] === null);

async function session(label, { stub, days, init = null, dir = "web", entry }) {
  const s = await boot.openSession({
    dir, entry, viewport: { width: 412, height: 915 }, noise,
    contextOptions: { timezoneId: "UTC" },
    beforeLoad: async ({ page, context }) => {
      watch(page);
      if (stub) await page.addInitScript(stub);
      if (init) await page.addInitScript(init);
      await context.clock.setFixedTime(dayAfterBuild(days));
    },
  });
  origins.add(new URL(s.url).origin); // each built folder is served from its own local address
  return s.page;
}

// ---- the hosted web app: nothing, however old (it has its own update notice) ----
{
  const hosted = await notes(boot.page);
  check(none(hosted), "the hosted web app shows no copy-age line on any screen, even 400 days after its build",
    () => "the hosted app showed " + JSON.stringify(hosted));
}

// ---- the Android app ----
{
  const young = await notes(await session("android +10", { stub: ANDROID, days: 10 }));
  check(none(young), "Android app, 10 days after its build: no line on Settings, Currency or Share", () => JSON.stringify(young));
  const before = await notes(await session("android +59", { stub: ANDROID, days: 59 }));
  check(none(before), "Android app, 59 days after its build: still no line (the threshold is 60)", () => JSON.stringify(before));

  const page = await session("android +60", { stub: ANDROID, days: 60 });
  const n = await notes(page);
  check(all(n, (x) => /built about 60 days ago/.test(x.text) && /releases page/i.test(x.text)),
    "Android app, 60 days after its build: the line appears on Settings, Currency and Share and says so in plain words",
    () => JSON.stringify(n));
  check(all(n, (x) => x.amber), "the line is amber, not red or neutral (it is a nudge, not an alarm)", () => JSON.stringify(n));
  check(all(n, (x) => x.href === RELEASES_LATEST && x.target === "_blank" && /noopener/.test(x.rel || "")),
    "on the Android app the line links to the GUIDON releases page (the way a tap on a link is already proven to work there)", () => JSON.stringify(n));
  check(all(n, (x) => x.buttons === 0 && !x.modal), "the line is not a modal and has nothing to dismiss, so it needs nothing saved", () => JSON.stringify(n));
  check(!/\b(UTC|stale|expired|outdated|deprecated)\b/i.test(n.about.text) && /A newer version may be out/.test(n.about.text),
    "the wording says 'may be out' and uses no builder words", () => n.about.text);
  await waitForRoute(page, "#/settings", { ready: ".fin-h" });
  const versionKept = await page.evaluate(() => /Version \S+ · Built \d{4}-\d{2}-\d{2}/.test(document.body.innerText));
  check(versionKept, "About still shows its Version and Built line as before", () => "the Version/Built line is gone");

  const old = await notes(await session("android +400", { stub: ANDROID, days: 400 }));
  check(all(old, (x) => /built about 13 months ago/.test(x.text)), "400 days is said in months, not as a number of days", () => JSON.stringify(old));
  const longAgo = await notes(await session("android +900", { stub: ANDROID, days: 900 }));
  check(all(longAgo, (x) => /built about 2 years ago/.test(x.text)), "900 days is said in years", () => JSON.stringify(longAgo));
}

// ---- a clock or a date that cannot be trusted: say nothing ----
{
  const early = await notes(await session("clock before build", { stub: ANDROID, days: -3 }));
  check(none(early), "a device clock set to before the build date shows no line (it is the clock that is wrong)", () => JSON.stringify(early));
  const absurd = await notes(await session("clock years ahead", { stub: ANDROID, days: 4000 }));
  check(none(absurd), "a clock 4,000 days after the build shows no line (older than any real copy)", () => JSON.stringify(absurd));
  const unknown = await notes(await session("no build date", { stub: ANDROID, days: 400, init: UNKNOWN_DATE }));
  check(none(unknown), "a build date that is not a date shows no line, however old the clock says it is", () => JSON.stringify(unknown));
}

// ---- the Windows app: no link until a tap there is proven; the address to copy instead ----
{
  const n = await notes(await session("tauri +90", { stub: TAURI, days: 90 }));
  check(all(n, (x) => /built about 3 months ago/.test(x.text)), "Windows app, 90 days after its build: the line appears on all three screens", () => JSON.stringify(n));
  check(all(n, (x) => x.href === null), "the Windows app gets no link (a tap there is not proven)", () => JSON.stringify(n));
  check(all(n, (x) => x.text.includes(RELEASES_LATEST)), "the Windows app shows the releases address as text to copy instead", () => JSON.stringify(n));
}

// ---- a saved file: the standalone build, over a web address and from a real file:// ----
{
  // (The saved file put on a web server: its own #/share is the hosted-style page, so only About and Currency.)
  const viaHttp = await notes(await session("standalone +100", { dir: "dist", days: 100 }), ["about", "currency"]);
  check(all(viaHttp, (x) => /built about 3 months ago/.test(x.text) && x.href === RELEASES_LATEST),
    "the saved-file copy, 100 days after its build: the line appears with a link to the releases page", () => JSON.stringify(viaHttp));

  const ctx = await boot.browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: "UTC" });
  await ctx.clock.setFixedTime(dayAfterBuild(100));
  const page = await ctx.newPage();
  watch(page);
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  await page.goto(pathToFileURL(path.join(APP, "dist", "guidon-standalone.html")).href, { waitUntil: "load" });
  await dismissOnboarding(page);
  await until(page, () => !(document.getElementById("app") || {}).inert);
  const fromFile = await notes(page);
  check(all(fromFile, (x) => x.days === "100" && x.href === RELEASES_LATEST),
    "opened from a real file:// address the same line and link appear", () => JSON.stringify(fromFile));
  await ctx.close();
}

// ---- nothing leaves the origin ----
{
  const away = requests.filter((u) => !([...origins].some((o) => u.startsWith(o + "/")) || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("file:") || u.startsWith("about:")));
  check(requests.length > 0 && away.length === 0, "no request from any session left the app's own local addresses (the link only does anything when tapped)",
    () => away.length + " outside request(s): " + away.slice(0, 5).join(" | "));
}
expectNoConsoleNoise(noise);
await finish("BUILD AGE");
