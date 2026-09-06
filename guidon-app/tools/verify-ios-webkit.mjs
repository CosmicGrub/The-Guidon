/**
 * GUIDON — iOS/WebKit pre-flight verification.
 *
 * WKWebView is WebKit. Playwright ships a real WebKit build, so this suite
 * catches the majority of iOS-only defects with no Mac, no iPhone, no cloud
 * minutes, no Apple account — before tools/ios-simulator-run.sh spends a real
 * GitHub Actions macOS runner booting the actual Simulator.
 *
 * Standing rule (GUIDON_PROJECT_MAP.md §8, rule 1): "verify the verifier."
 * This suite was validated against a fixture with five planted defects (a
 * 100vh panel, a 14px input, a 30x30 tap target, a 120vw element, no
 * viewport-fit); it caught all five on all five devices and exited 1. Its
 * first run against the real corpus then produced two false positives, both
 * fixed here and both worth remembering:
 *
 *   - the `.skip-link` sits at left:-999px. It is not a tap target, it is an
 *     accessibility affordance. `offsetParent !== null` does not exclude it;
 *     an explicit off-screen test does.
 *   - a 12x12 checkbox with a large adjacent <label> is a 12x12 tap target
 *     ONLY if the label is not associated with it. Measuring the input's box
 *     alone would flag every correctly-labelled checkbox in the app. The
 *     effective target is the union of the control and its labels, read from
 *     `el.labels` (the live association), never from the markup.
 *
 * That second fix is what surfaced the `htmlFor` bug in records.js — the
 * union measurement stayed 12x12 there because the association was broken.
 *
 * Same conventions as tools/verify.mjs: reuse serve(), derive the route list
 * from window.G.routes rather than hand-maintaining it (rule 4 - a hand-
 * copied list silently fell behind once already), capture console "warning"
 * as well as "error".
 *
 * Usage: node tools/verify-ios-webkit.mjs [webDir] [--shots] [--headed]
 */
import { webkit, devices } from "playwright";
import { serve } from "./server.mjs";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { probeViaPlaywright, writeProbe } from "./caps-probe.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

const args = process.argv.slice(2);
const WEB = args.find((a) => !a.startsWith("--")) || "web";
const SHOTS = args.includes("--shots");
const HEADED = args.includes("--headed");
const SETTLE_NAV = 250;
const SETTLE_ROUTE = 150;
const OUT = "artifacts/ios-webkit";
const MIN_TAP = 44;   // Apple HIG
const MIN_FONT = 16;  // below this iOS zooms the page on focus

// iOS device matrix - matches the Simulator fleet tools/ios-simulator-run.sh
// boots in CI (see the `devices` default in .github/workflows/ios.yml), so a
// failure caught here reproduces there. Viewport/UA/DPR come from Playwright's
// own maintained device descriptors, not hand-typed - the iPad has no exact
// "10th gen" descriptor upstream, so it borrows iPad (gen 7)'s UA/touch profile
// and overrides just the viewport to the real 10th-gen CSS size.
const DEVICES = [
  { name: "iphone-se3", ...devices["iPhone SE (3rd gen)"] },
  { name: "iphone-13mini", ...devices["iPhone 13 Mini"] },
  { name: "iphone-16", ...devices["iPhone 16"] },
  { name: "iphone-16-pro-max", ...devices["iPhone 16 Pro Max"] },
  { name: "ipad-10th-gen", ...devices["iPad (gen 7)"], viewport: { width: 820, height: 1180 } },
];

const results = { pass: [], fail: [] };
const ok = (m) => { results.pass.push(m); console.log("  PASS  " + m); };
const bad = (m) => { results.fail.push(m); console.log("  FAIL  " + m); };

/* Route-sweep findings are CSS/DOM defects, so the same defect reappears on
   every device. Keyed dedupe turns 261 lines of noise into a short list of
   real defects, each carrying the devices it was seen on. */
const defects = new Map();
function defect(check, route, signature, detail, device) {
  /* Keyed on check+signature ONLY. A CSS rule is one defect however many
     routes render it; keying on route as well reported the same two topbar
     buttons 69 times and made the headline count about 5x the real work.
     Routes are kept as evidence, not as multiplicity. */
  const key = `${check}\u0000${signature}`;
  let d = defects.get(key);
  if (!d) { d = { check, signature, detail, routes: new Set(), devices: new Set() }; defects.set(key, d); }
  d.routes.add(route);
  d.devices.add(device);
}

/* Everything below runs inside the page. Kept as one string so the helpers
   (visibility, signature, effective tap rect) are defined once and shared by
   all three sweep checks rather than duplicated per evaluate() call. */
const SWEEP = ({ minTap, minFont }) => {
  const vis = (el) => {
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    // Parked off-screen (the .skip-link pattern): not a tap target, not a
    // rendering defect. Below-the-fold is NOT off-screen - it scrolls into view.
    if (r.right <= 0 || r.bottom <= 0) return false;
    return true;
  };

  const sig = (el) => {
    const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    const id = el.id ? "#" + el.id.replace(/\d+/g, "N") : "";
    const type = el.getAttribute("type") ? `[type=${el.getAttribute("type")}]` : "";
    return el.tagName.toLowerCase() + type + (cls ? "." + cls : "") + id;
  };

  /* A control's real tap target is itself UNION its associated labels - a
     12x12 checkbox with a properly-associated label is a fine tap target.
     `el.labels` is the live association, so a `for`/`htmlFor` mistake in the
     markup correctly shows up here as a too-small target. */
  const tapRect = (el) => {
    let r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    const labels = el.labels ? [...el.labels] : [];
    for (const l of labels) {
      const lr = l.getBoundingClientRect();
      if (lr.width === 0 || lr.height === 0) continue;
      left = Math.min(left, lr.left); top = Math.min(top, lr.top);
      right = Math.max(right, lr.right); bottom = Math.max(bottom, lr.bottom);
    }
    return { width: right - left, height: bottom - top, labelled: labels.length > 0 };
  };

  const out = { overflow: 0, fonts: [], taps: [], orphanLabels: [], badText: false };

  out.overflow = document.documentElement.scrollWidth - window.innerWidth;

  /* Only a control that raises a KEYBOARD can trigger iOS's focus zoom. A
     checkbox, radio, slider or button-like input never does, and counting
     them inflated this check by roughly half on the real corpus. */
  const NO_KEYBOARD = new Set(["checkbox", "radio", "range", "color", "file", "submit", "reset", "button", "image", "hidden"]);
  for (const el of document.querySelectorAll("input,select,textarea")) {
    if (!vis(el)) continue;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (el.tagName === "INPUT" && NO_KEYBOARD.has(type)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size && size < minFont) out.fonts.push({ sig: sig(el), size });
  }

  const TAPPABLE = 'button,a[href],[role="button"],.click,input[type="checkbox"],input[type="radio"],select';
  for (const el of document.querySelectorAll(TAPPABLE)) {
    if (!vis(el)) continue;
    // An inline anchor inside running text is sized by the line box, and the
    // HIG 44pt minimum is for controls, not for links in a sentence. Skip
    // display:inline anchors; block/flex/grid anchors (link-styled buttons)
    // are still measured.
    if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;
    const r = tapRect(el);
    // Half a CSS pixel of tolerance: a 43.6px control rounds to "44" in the
    // report and is indistinguishable from a pass to anyone reading it, yet it
    // failed the strict comparison. Sub-half-pixel is below any tap-accuracy
    // threshold, so it is noise, not a defect.
    if (r.width < minTap - 0.5 || r.height < minTap - 0.5) {
      out.taps.push({ sig: sig(el), w: Math.round(r.width), h: Math.round(r.height), labelled: r.labelled });
    }
  }

  /* A <label> that points at nothing is a tap target the user will press and
     see nothing happen. `label.control` is the resolved association. */
  for (const l of document.querySelectorAll("label")) {
    if (!vis(l)) continue;
    const declaresTarget = l.hasAttribute("for") || l.hasAttribute("htmlfor");
    if (declaresTarget && !l.control) out.orphanLabels.push({ sig: sig(l), text: (l.textContent || "").trim().slice(0, 40) });
  }

  out.badText = /Invalid Date|\bNaN\b/.test(document.body.innerText);
  return out;
};

async function main() {
  // ---------- 0. static source audit: bare vh, once, engine-independent ----------
  console.log("[0] Static CSS audit (bare vh without dvh/svh/lvh fallback)");
  const indexPath = join(process.cwd(), WEB, "index.html");
  const html = await readFile(indexPath, "utf8").catch(() => null);
  if (html == null) {
    console.error(`\n${indexPath} does not exist - run "npm run build" first.`);
    process.exit(2);
  }
  /* Two measured false-positive sources: a 66vh sitting inside a CSS COMMENT
     describing an abandoned design, and the second half of a deliberate
     `height:100vh; height:100dvh` fallback pair, which is correct authoring.
     Strip comments, then drop any vh whose property is re-declared just
     afterwards with a dvh/svh/lvh value. */
  const cssText = html.replace(/\/\*[\s\S]*?\*\//g, "");

  /* Classify every vh declaration rather than counting it:
       PAIRED    - the same property is re-declared just after with dvh/svh/lvh.
                   That is the correct fallback idiom, not a defect.
       BOUNDED   - a max-* property, a margin, or a value wrapped in min()/max()/
                   clamp(). A maximum can only shrink and a bound cannot overflow
                   the viewport, so iOS chrome cannot clip it. Reported, not failed.
       UNBOUNDED - height / min-height / inset-style values that ARE the layout.
                   These are what 100vh-under-Safari-chrome actually breaks.
     Measured on v1.5.0: 12 declarations, of which 3 paired, 8 bounded, 1 unbounded.
     Counting all 12 as failures was crying wolf eleven times out of twelve. */
  const vhAll = [...cssText.matchAll(/([a-z-]+)\s*:\s*([^;{}]*?\d+(?:\.\d+)?vh\b[^;{}]*);/gi)];
  const vhPaired = [], vhBounded = [], vhUnbounded = [];
  for (const m of vhAll) {
    const prop = m[1].toLowerCase();
    const decl = m[0].replace(/\s+/g, " ").trim();
    const tail = cssText.slice(m.index + m[0].length, m.index + m[0].length + 200);
    // The pattern is built at runtime, so the backslashes must survive the string
    // literal: a single "\s" in JS source is just "s". Doubled here on purpose.
    const paired = new RegExp(prop + "\\s*:\\s*[^;{}]*\\d+(?:d|s|l)vh", "i").test(tail);
    const bounded = prop.startsWith("max-") || prop === "margin" || /\b(?:min|max|clamp)\s*\(/.test(decl);
    (paired ? vhPaired : bounded ? vhBounded : vhUnbounded).push(decl.slice(0, 60));
  }
  if (vhUnbounded.length) {
    bad(`${vhUnbounded.length} UNBOUNDED "vh" declaration(s) - iOS Safari chrome clips these: ${vhUnbounded.slice(0, 6).join(" | ")}`);
  } else ok(`no unbounded vh values (${vhPaired.length} paired with dvh, ${vhBounded.length} bounded by max-*/min()/clamp())`);
  if (vhBounded.length || vhPaired.length) {
    console.log(`    info: ${vhPaired.length} paired, ${vhBounded.length} bounded - not defects`);
  }

  const { server, url } = await serve(WEB);
  console.log("\nserving " + WEB + " at " + url);
  if (SHOTS) await mkdir(OUT, { recursive: true });

  const browser = await webkit.launch({ headless: !HEADED });

  try {
    for (const device of DEVICES) {
      const { name, ...ctxOpts } = device;
      console.log(`\n=== ${name} (${ctxOpts.viewport.width}x${ctxOpts.viewport.height}) ===`);
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      const msgs = [];
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") msgs.push(`${m.type()}: ${m.text()}`);
      });
      page.on("pageerror", (e) => msgs.push("pageerror: " + e.message));

      await page.goto(url, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_NAV);

      // ---------- 1. viewport-fit=cover (prerequisite for safe-area insets) ----------
      const vpMeta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.content || "");
      vpMeta.includes("viewport-fit=cover")
        ? ok(`${name}: viewport-fit=cover present`)
        : bad(`${name}: missing viewport-fit=cover - safe-area insets won't apply`);

      const { dismissed } = await dismissOnboarding(page);
      await page.waitForTimeout(dismissed ? 600 : 0);
      if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png` });

      const routes = await page.evaluate(() =>
        window.G && window.G.routes ? window.G.routes.map((r) => r.hash || r) : null
      );
      if (!routes || !routes.length) { bad(`${name}: G.routes not exposed - cannot sweep sections`); }
      else ok(`${name}: G.routes exposed, ${routes.length} sections`);

      // ---------- 2/3/5/6. per-route sweep ----------
      let nOverflow = 0, nFont = 0, nTap = 0, nOrphan = 0, nText = 0;
      for (const r of routes || []) {
        await page.evaluate((h) => { location.hash = h; }, r);
        await page.waitForTimeout(SETTLE_ROUTE);
        const s = await page.evaluate(SWEEP, { minTap: MIN_TAP, minFont: MIN_FONT });

        if (s.overflow > 1) { nOverflow++; defect("overflow", r, "document", `${s.overflow}px wider than viewport`, name); }
        for (const f of s.fonts) { nFont++; defect("font<16", r, f.sig, `${f.size}px`, name); }
        for (const t of s.taps) {
          nTap++;
          defect("tap<44", r, t.sig, `${t.w}x${t.h}${t.labelled ? " (incl. label)" : ""}`, name);
        }
        for (const l of s.orphanLabels) { nOrphan++; defect("orphan-label", r, l.sig, `"${l.text}" points at nothing`, name); }
        if (s.badText) { nText++; defect("bad-text", r, "body", "Invalid Date or NaN rendered", name); }
      }
      if (routes && routes.length) {
        const summary = [
          nOverflow ? `${nOverflow} overflow` : null,
          nFont ? `${nFont} small-font` : null,
          nTap ? `${nTap} small-tap` : null,
          nOrphan ? `${nOrphan} orphan-label` : null,
          nText ? `${nText} bad-text` : null,
        ].filter(Boolean);
        summary.length
          ? bad(`${name}: ${routes.length} routes swept - ${summary.join(", ")} (deduped detail below)`)
          : ok(`${name}: ${routes.length} routes clean - no overflow, fonts, tap targets or date defects`);
      }

      // ---------- 6b. capability probe (collective P2) ----------
      // Playwright's WebKit is the ENGINE without the platform, so this file
      // is tagged engineOnly:true and tools/caps-matrix.mjs shows it
      // labelled, never as iOS ship evidence - package.json's "_note:ios"
      // (navigator.storage/share/Notification/Fullscreen differ from real
      // iOS) is now measured on every run instead of asserted once. The
      // standing rule stands: this suite owns rendering; capability on real
      // iOS is settled on the Simulator (tools/ios-simulator-run.sh).
      const capsPayload = await probeViaPlaywright(page);
      if (!capsPayload) bad(`${name}: no GUIDON_CAPS sentinel within 8s of #/selftest?probe=1 - the build lacks the capability probe`);
      else {
        const n = Object.keys(capsPayload.caps || {}).length;
        const supported = Object.values(capsPayload.caps || {}).filter(Boolean).length;
        const file = await writeProbe({
          engine: "webkit", device: name, collector: "tools/verify-ios-webkit.mjs", payload: capsPayload,
          engineOnly: true, note: "Playwright WebKit " + (capsPayload.engineVersion || "?") + " on " + process.platform + " emulating " + name + " - engine only, not iOS",
        });
        ok(`${name}: capability probe captured (${supported}/${n} supported, engine only) -> ${file}`);
      }

      // ---------- 7. service worker registers under WebKit ----------
      const sw = await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return { ok: false, why: "unsupported" };
        try {
          const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((res) => setTimeout(() => res(null), 15000)),
          ]);
          return reg ? { ok: true, scope: reg.scope } : { ok: false, why: "timeout" };
        } catch (e) { return { ok: false, why: String(e) }; }
      });
      sw.ok ? ok(`${name}: service worker active, scope ${sw.scope}`) : bad(`${name}: service worker not active - ${sw.why}`);

      // ---------- 8. localStorage survives reload ----------
      await page.evaluate(() => localStorage.setItem("__ios_verify__", "1"));
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(300);
      const lsOk = await page.evaluate(() => localStorage.getItem("__ios_verify__") === "1");
      lsOk ? ok(`${name}: localStorage survives reload`) : bad(`${name}: localStorage did not survive reload`);
      await page.evaluate(() => localStorage.removeItem("__ios_verify__")).catch(() => {});

      // ---------- 9. IndexedDB survives reload ----------
      const idbWrite = await page.evaluate(() => new Promise((resolve) => {
        if (!("indexedDB" in window)) return resolve("unsupported");
        const req = indexedDB.open("__ios_verify__", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put("1", "k");
          tx.oncomplete = () => { db.close(); resolve("written"); };
          tx.onerror = () => resolve("error");
        };
        req.onerror = () => resolve("error");
      }));
      if (idbWrite === "written") {
        await page.reload({ waitUntil: "load" });
        await page.waitForTimeout(300);
        const idbRead = await page.evaluate(() => new Promise((resolve) => {
          const req = indexedDB.open("__ios_verify__", 1);
          req.onsuccess = () => {
            const db = req.result;
            const g = db.transaction("kv", "readonly").objectStore("kv").get("k");
            g.onsuccess = () => resolve(g.result);
            g.onerror = () => resolve(null);
          };
          req.onerror = () => resolve(null);
        }));
        idbRead === "1" ? ok(`${name}: IndexedDB survives reload`) : bad(`${name}: IndexedDB did not survive reload`);
        await page.evaluate(() => indexedDB.deleteDatabase("__ios_verify__")).catch(() => {});
      } else if (idbWrite === "unsupported") {
        bad(`${name}: IndexedDB unsupported in this context`);
      } else {
        bad(`${name}: IndexedDB write failed`);
      }

      // ---------- 10. console cleanliness ----------
      msgs.length === 0
        ? ok(`${name}: zero console errors/warnings`)
        : bad(`${name}: ${msgs.length} console msg(s); first: ${msgs[0]}`);

      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // ---------- deduped defect report ----------
  const LABELS = {
    "overflow": "Horizontal overflow",
    "font<16": `Form controls under ${MIN_FONT}px (iOS zooms the page on focus)`,
    "tap<44": `Tap targets under ${MIN_TAP}x${MIN_TAP} (Apple HIG), label association included`,
    "orphan-label": "Labels associated with nothing (tap does nothing, no SR association)",
    "bad-text": "Invalid Date / NaN rendered",
  };
  const byCheck = new Map();
  for (const d of defects.values()) {
    if (!byCheck.has(d.check)) byCheck.set(d.check, []);
    byCheck.get(d.check).push(d);
  }

  if (defects.size) {
    console.log("\n" + "=".repeat(64));
    console.log("DEFECTS (deduped across devices)");
    console.log("=".repeat(64));
    for (const [check, list] of byCheck) {
      /* Ordered by blast radius: the selector on the most routes is the one
         worth fixing first. Two topbar buttons account for most of the tap
         findings precisely because they render on every route. */
      list.sort((a, b) => b.routes.size - a.routes.size);
      console.log(`\n${LABELS[check] || check} - ${list.length} unique selector(s):`);
      for (const d of list) {
        const dev = d.devices.size === DEVICES.length ? "all devices" : [...d.devices].join(",");
        const routes = [...d.routes];
        const where = routes.length === 1
          ? routes[0]
          : `${routes.length} routes (${routes.slice(0, 3).join(", ")}${routes.length > 3 ? ", ..." : ""})`;
        console.log(`  ${d.signature}`);
        console.log(`      ${d.detail}  ·  ${where}  ·  [${dev}]`);
      }
    }
  }

  console.log("\n" + "=".repeat(64));
  const routeHits = [...defects.values()].reduce((n, d) => n + d.routes.size, 0);
  console.log(`RESULT: ${results.pass.length} pass, ${results.fail.length} fail, ${defects.size} unique defect(s) across ${routeHits} route occurrence(s)`);
  console.log("=".repeat(64));
  process.exit(results.fail.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
