/**
 * W1 "app defect polish": one pass over the small defects found by the
 * 2026-11 device/mockup captures, each pinned so it cannot quietly return.
 *   A1/A2  #/share Install panel wording by build (Android app vs desktop app)
 *          and the storage-durability advice
 *   A3/A11 installed iPhone app: no Add-to-Home-Screen steps, no "Start menu"
 *   A4     Board Drill flipped card: star never covers the mastery meter
 *   A5     "1 question" not "1 questions" (G.util.plural)
 *   A6     date fields as tall as the text boxes on the DA 4856 form
 *   A7/A13 nav rail: every item has a name/tooltip; a pinned route is listed once
 *   A8/A9  no "v0.x" version stamp or raw "#/route" text in notices
 *   A10    Readiness "Questions mastered" row stays on one line at 412 and 360
 *   A14    Board date field shows a visible "Pick a date"
 *   C1     a delete confirm ignores Enter from the message region (short window)
 *   C2     old "TC 4-02.1" quiz-best rows move to "ATP 4-02.11"
 *   C7     Biometric Lock is not offered in search where the device cannot do it
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { waitForBoot, waitForRoute, until, untilAsync, PERSONAL_PROFILE, PROFILE_KEY } from "./testkit.mjs";
import { readFileSync, readdirSync } from "node:fs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (c, m, d) => (c ? ok(m) : bad(m + (d ? "  [" + d + "]" : "")));

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

async function open(opts, init, hash) {
  const ctx = await browser.newContext(opts || {});
  const page = await ctx.newPage();
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  if (init) await page.addInitScript(init);
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await waitForBoot(page);
  if (hash) { await page.evaluate((h) => { location.hash = h; }, hash); await waitForRoute(page, hash); }
  return page;
}
const shareText = (page) => page.evaluate(() => {
  const w = document.querySelector(".pwa-panel-wrap");
  return { panel: w ? w.innerText : "", all: document.querySelector(".view").innerText };
});
const stubStorage = () => {
  try { Object.defineProperty(navigator, "storage", { value: { persisted: async () => false, persist: async () => false, estimate: async () => ({ usage: 1, quota: 2 }) }, configurable: true }); } catch (e) { /* ignore */ }
};

// ---------------------------------------------------------------- A1 / A2
{
  const page = await open({ viewport: { width: 800, height: 1100 } }, () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} };
    try { Object.defineProperty(navigator, "storage", { value: { persisted: async () => false, persist: async () => false, estimate: async () => ({ usage: 1, quota: 2 }) }, configurable: true }); } catch (e) { /* ignore */ }
  }, "#/share");
  const t = await shareText(page);
  check(/installed Android app/.test(t.panel) && /stored on this device/.test(t.panel), "A1: Android build says Android app / this device", t.panel.slice(0, 160));
  check(!/desktop application|this computer/.test(t.panel), "A1: Android build never says desktop application or this computer");
  check(/storage durability/i.test(t.panel) && !/home screen/i.test(t.panel), "A2: Android app storage row gives no home-screen advice", t.panel);
  await page.context().close();
}
{
  const page = await open({ viewport: { width: 1000, height: 900 } }, () => { window.__TAURI_INTERNALS__ = {}; }, "#/share");
  const t = await shareText(page);
  check(/installed desktop application/.test(t.panel) && /this computer/.test(t.panel), "A1: desktop app still says desktop application / this computer");
  check(!/home screen/i.test(t.panel), "A2: desktop app storage row gives no home-screen advice");
  await page.context().close();
}
{
  const page = await open({ viewport: { width: 1000, height: 900 } }, stubStorage, "#/share");
  const t = await shareText(page);
  check(/Not granted\. Installing the app to your home screen/.test(t.panel), "A2: a plain browser tab keeps the home-screen advice", t.panel);
  await page.context().close();
}
// ---------------------------------------------------------------- A3 / A11
{
  const standalone = () => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    try { Object.defineProperty(navigator, "storage", { value: { persisted: async () => false, persist: async () => false, estimate: async () => ({ usage: 1, quota: 2 }) }, configurable: true }); } catch (e) { /* ignore */ }
  };
  const page = await open({ userAgent: IOS_UA, viewport: { width: 390, height: 844 }, hasTouch: true }, standalone, "#/share");
  const t = await shareText(page);
  check(/already installed on your Home Screen/.test(t.all), "A3: installed iPhone app says it is already installed", t.all.slice(0, 200));
  check(!/Add to Home Screen/.test(t.all) && !/iPhone \/ iPad steps/.test(t.all) && !/read this before you start studying/.test(t.all), "A3: installed iPhone app shows no Add-to-Home-Screen steps");
  check(/opens from your home screen/.test(t.panel) && !/Start menu/.test(t.panel), "A11: installed iPhone panel says home screen, never Start menu", t.panel.slice(0, 200));
  check(!/home screen is what usually/i.test(t.panel), "A11: installed iPhone storage row gives no home-screen advice");
  await page.context().close();
}
{
  const page = await open({ userAgent: IOS_UA, viewport: { width: 390, height: 844 }, hasTouch: true }, null, "#/share");
  const t = await shareText(page);
  check(/Add to Home Screen/.test(t.all) && /read this before you start studying/.test(t.all), "A3: iPhone in Safari still shows the Add-to-Home-Screen steps");
  await page.context().close();
}

// ---------------------------------------------------------------- A5 / A8 / A9 (text)
{
  const page = await open({ viewport: { width: 1000, height: 800 } }, null, "#/home");
  const r = await page.evaluate(() => [G.util.plural(1, "question"), G.util.plural(0, "question"), G.util.plural(2, "question"), G.util.plural(1, "category", "categories"), G.util.plural(3, "category", "categories")]);
  check(JSON.stringify(r) === JSON.stringify(["1 question", "0 questions", "2 questions", "1 category", "3 categories"]), "A5: plural helper agrees with the count", JSON.stringify(r));
  const asOfs = await page.evaluate(() => { const out = []; (function walk(o) { if (o && typeof o === "object") for (const k in o) { if (k === "asOf" && typeof o[k] === "string") out.push(o[k]); else walk(o[k]); } })(window.GUIDON_SEED); return out; });
  check(asOfs.length > 5 && asOfs.every((s) => !/\bv\d+\.\d+/.test(s)), "A8: no seed 'as of' notice carries a version stamp like v0.43.1", asOfs.filter((s) => /\bv\d+\.\d+/.test(s)).join(" | "));
  await page.evaluate(() => { location.hash = "#/counsel"; }); await waitForRoute(page, "#/counsel");
  const c = await page.evaluate(() => document.querySelector(".view").innerText);
  check(!/\bv0\.\d+/.test(c) && /includes 59 DA 4856 examples/.test(c), "A8: #/counsel notice reads in plain words", (c.match(/As of[^\n]*/) || [""])[0]);
  await page.evaluate(() => { location.hash = "#/calendar"; }); await waitForRoute(page, "#/calendar");
  const cal = await page.evaluate(() => document.querySelector(".view").innerText);
  check(!/#\//.test(cal), "A9: #/calendar shows no raw route text");
  await page.context().close();
}
{ // source guard: user-facing prose never prints a raw "#/route"
  const files = ["src/index.html", ...readdirSync("src/app-modules").filter((f) => f.endsWith(".js")).map((f) => "src/app-modules/" + f)];
  const hits = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      if (l.length > 5000) return;
      const t = l.trim();
      if (/^(\/\/|\*|\/\*)/.test(t)) return;
      for (const m of l.matchAll(/"([^"\n]{0,200}\s#\/[a-z][^"\n]*)"/g)) hits.push(f + ":" + (i + 1) + " " + m[1].slice(0, 80));
    });
  }
  check(hits.length === 0, "A9: no user-facing string contains a raw '#/route'", hits.join(" | "));
}

// ---------------------------------------------------------------- A4
{
  const page = await open({ viewport: { width: 1000, height: 900 } }, null, "#/board");
  await page.waitForSelector(".qz-card", { timeout: 8000 });
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel);
  const overlap = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  const star0 = await rect(".qz-star-btn");
  check(!!star0, "A4: star present on the question side");
  await page.click(".qz-card", { position: { x: 60, y: 120 } }).catch(() => {});
  const settled = await until(page, () => { const c = document.querySelector(".qz-card.flipped"); return !!c && c.getAnimations().every((a) => a.playState !== "running"); });
  check(settled, "A4: the card flipped and stopped moving");
  const star = await rect(".qz-star-btn"), meter = await rect(".qz-back .qz-mastery-seg");
  check(!!meter && !!star && !overlap(star, meter), "A4: flipped card - star and the first mastery-meter segment do not overlap", JSON.stringify({ star, meter }));
  const card = await rect(".qz-card");
  check(star && card && star.r > card.l + (card.r - card.l) * 0.6, "A4: star sits on the right of the card on the flipped face too", JSON.stringify({ star, card }));
  await page.context().close();
}

// ---------------------------------------------------------------- A6
{
  const page = await open({ viewport: { width: 1280, height: 900 } }, null, "#/forms");
  await page.evaluate(() => { [...document.querySelectorAll(".form-card")].find((e) => /DA Form 4856/.test(e.textContent)).click(); });
  await page.waitForSelector('input.in[type="date"]', { timeout: 6000 });
  const h = await page.evaluate(() => { const hh = (e) => Math.round(e.getBoundingClientRect().height * 10) / 10; return { date: hh(document.querySelector('input.in[type="date"]')), text: hh(document.querySelector('input.in[type="text"]')) }; });
  check(Math.abs(h.date - h.text) <= 1.5, "A6: DA 4856 date field is as tall as the text fields", JSON.stringify(h));
  await page.context().close();
}

// ---------------------------------------------------------------- A7 / A13
{
  const page = await open({ viewport: { width: 800, height: 1100 } }, () => { try { localStorage.setItem("guidon-nav-pinned-routes", JSON.stringify(["#/board", "#/train"])); } catch (e) { /* ignore */ } }, "#/board");
  const r = await page.evaluate(() => {
    const links = [...document.querySelectorAll("nav.nav a[data-hash]")].filter((a) => !a.closest(".nav-dup-pinned"));
    return {
      unnamed: links.filter((a) => !(a.getAttribute("aria-label") || "").trim() || !(a.getAttribute("title") || "").trim()).map((a) => a.dataset.hash),
      board: links.filter((a) => a.dataset.hash === "#/board").length,
      train: links.filter((a) => a.dataset.hash === "#/train").length,
      pinnedHas: [...document.querySelectorAll("nav.nav .nav-pinned-section a[data-hash]")].map((a) => a.dataset.hash),
    };
  });
  check(r.unnamed.length === 0, "A7: every nav item has an accessible name and a tooltip", r.unnamed.join(","));
  check(r.board === 1 && r.train === 1 && r.pinnedHas.includes("#/board") && r.pinnedHas.includes("#/train"), "A13: a pinned route is listed once (in Pinned), at 800 px", JSON.stringify(r));
  // arrow keys step over the hidden copy: walk the whole list; every stop must be a drawn link
  const walk = await page.evaluate(async () => {
    const first = document.querySelector("nav.nav .nav-pinned-section a[data-hash]");
    first.focus();
    const seen = [];
    for (let i = 0; i < 40; i++) {
      const before = document.activeElement;
      document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
      const now = document.activeElement;
      seen.push({ hidden: !!(now && now.closest && now.closest(".nav-dup-pinned")), moved: now !== before });
      if (now === before) break;
    }
    return { steps: seen.length, anyHidden: seen.some((x) => x.hidden), stuckEarly: seen.length < 6 };
  });
  check(!walk.anyHidden && !walk.stuckEarly, "A13: arrow keys never land on the hidden duplicate and keep moving through the list", JSON.stringify(walk));
  await page.evaluate(() => { document.querySelector("nav.nav .nav-pinned-section .nav-pin-btn.pinned").click(); });
  await until(page, () => document.querySelectorAll("nav.nav .nav-pinned-section a[data-hash]").length === 1);
  const after = await page.evaluate(() => [...document.querySelectorAll("nav.nav a[data-hash]")].filter((a) => !a.closest(".nav-dup-pinned") && (a.dataset.hash === "#/train" || a.dataset.hash === "#/board")).length);
  check(after === 2, "A13: unpinning one returns it to its group (still listed once each)", String(after));
  await page.context().close();
}

// ---------------------------------------------------------------- A10 / A14
for (const w of [412, 360]) {
  const page = await open({ viewport: { width: w, height: 900 }, hasTouch: true }, null, "#/board");
  await page.locator("button", { hasText: /^Readiness$/i }).first().click();
  await until(page, () => [...document.querySelectorAll(".stat")].some((s) => /Questions mastered/.test(s.textContent)));
  const m = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".stat")].find((s) => /Questions mastered/.test(s.textContent));
    if (!row) return null;
    const v = row.querySelector(".v");
    const lh = parseFloat(getComputedStyle(v).lineHeight) || 16;
    return { vh: v.getBoundingClientRect().height, lh, text: v.textContent, over: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  check(m && m.vh < m.lh * 1.6 && !m.over, "A10: 'Questions mastered' value stays on one line at " + w + " px", JSON.stringify(m));
  await page.context().close();
}
{
  const page = await open({ viewport: { width: 800, height: 1100 } }, null, "#/board");
  const r = await page.evaluate(() => {
    const inp = document.querySelector('input[aria-label="Set your board date"]');
    const row = inp && inp.closest(".mini-row");
    const hint = row && row.nextElementSibling;
    return { hasInput: !!inp, hint: hint ? hint.textContent : "", dateHasOverlay: !!document.querySelector(".date-ph") };
  });
  check(r.hasInput && /^Pick a date, then tap Set\./.test(r.hint) && !r.dateHasOverlay, "A14: the empty Board date field is explained in words right under it ('Pick a date, then tap Set')", JSON.stringify(r));
  await page.context().close();
}

// ---------------------------------------------------------------- C1
{
  const page = await open({ viewport: { width: 320, height: 480 } }, null, "#/home");
  await page.evaluate(() => {
    window.__c1 = "pending";
    const long = Array.from({ length: 60 }, (_, i) => "Line " + (i + 1) + " of a long warning.").join("\n");
    G.modal.confirm(long, { title: "Delete everything?", okText: "Delete", danger: true }).then((v) => { window.__c1 = v; });
  });
  await until(page, () => { const b = document.querySelector(".gm-dialog-body"); return !!b && b.tabIndex === 0; });
  const res = await page.evaluate(() => {
    const body = document.querySelector(".gm-dialog-body");
    body.focus();
    return { focusable: body.tabIndex === 0, active: document.activeElement === body };
  });
  check(res.focusable && res.active, "C1: short window - the message is a Tab stop (the case being guarded)", JSON.stringify(res));
  await page.keyboard.press("Enter");
  await until(page, () => true);
  const still = await page.evaluate(() => ({ v: window.__c1, open: !!document.querySelector(".gm-dialog") }));
  check(still.v === "pending" && still.open, "C1: Enter in the message region does not confirm a delete", JSON.stringify(still));
  await page.focus(".gm-dialog .btn-row .btn:last-child");
  await page.keyboard.press("Enter");
  await until(page, () => window.__c1 === true);
  check(await page.evaluate(() => window.__c1 === true), "C1: Enter on the Delete button itself still confirms");
  await page.context().close();
}

// ---------------------------------------------------------------- C2
{
  const page = await open({ viewport: { width: 1000, height: 800 } }, null, "#/home");
  const P = "boardQuiz:best:";
  const guest = await page.evaluate(async (P) => {
    await G.db.put("kv", { k: P + "TC 4-02.1", v: 70 });
    const moved = await G.board.migrateQuizBestKeys();
    return { moved, old: (await G.db.get("kv", P + "TC 4-02.1")) || null, nw: (await G.db.get("kv", P + "ATP 4-02.11")) || null };
  }, P);
  check(guest.moved === 0 && guest.old && guest.old.v === 70 && !guest.nw, "C2: Guest/Kiosk - nothing is moved", JSON.stringify(guest));
  await page.context().close();
}
{
  // A real cold start: a saved personal profile and legacy rows already on the device. Nothing is
  // called by hand - the app's own start-up must do the move (isGuest() is true until the profile loads).
  const P = "boardQuiz:best:";
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await pg.goto(url, { waitUntil: "load" });
  await pg.waitForFunction(() => !!(window.G && window.G.db && typeof window.G.db.put === "function"));
  await pg.evaluate(async ([P, prof, key]) => {
    await G.db.put("kv", { k: key, v: prof });
    await G.db.put("kv", { k: P + "TC 4-02.1", v: 70 });
    await G.db.put("kv", { k: P + "TC 4-02.1:expert", v: 55 });
    await G.db.put("kv", { k: P + "ATP 4-02.11:expert", v: 90 });   // a newer value is already there
  }, [P, PERSONAL_PROFILE, PROFILE_KEY]);
  await pg.reload({ waitUntil: "load" });
  await waitForBoot(pg);
  const moved = await untilAsync(pg, async () => !(await G.db.get("kv", "boardQuiz:best:TC 4-02.1")));
  const r2 = await pg.evaluate(async (P) => {
    const g = async (k) => { const r = await G.db.get("kv", k); return r ? r.v : null; };
    return { again: await G.board.migrateQuizBestKeys(), base: await g(P + "ATP 4-02.11"), baseOld: await g(P + "TC 4-02.1"), exp: await g(P + "ATP 4-02.11:expert"), expOld: await g(P + "TC 4-02.1:expert") };
  }, P);
  check(moved, "C2: a saved personal profile - the legacy quiz-best row is moved by the app's own start-up", JSON.stringify(r2));
  check(r2.base === 70 && r2.baseOld === null, "C2: the old best now lives under ATP 4-02.11", JSON.stringify(r2));
  check(r2.exp === 90 && r2.expOld === null, "C2: a newer value under the new name is never overwritten", JSON.stringify(r2));
  check(r2.again === 0, "C2: running it again does nothing (idempotent)", JSON.stringify(r2));
  // Kiosk keeps nothing on the device: a legacy row stays exactly as it was.
  await pg.evaluate(async ([P, key, prof]) => {
    await G.db.put("kv", { k: key, v: Object.assign({}, prof, { mode: "kiosk" }) });
    await G.db.put("kv", { k: P + "TC 4-02.1", v: 61 });
  }, [P, PROFILE_KEY, PERSONAL_PROFILE]);
  await pg.reload({ waitUntil: "load" });
  await waitForBoot(pg);
  const k = await pg.evaluate(async (P) => { const n = await G.board.migrateQuizBestKeys(); const r = await G.db.get("kv", P + "TC 4-02.1"); return { n, old: r ? r.v : null, mode: (await G.profile.current() || {}).mode }; }, P);
  check(k.mode === "kiosk" && k.n === 0 && k.old === 61, "C2: Kiosk - nothing is moved", JSON.stringify(k));
  await ctx.close();
}

// ---------------------------------------------------------------- C7
{
  const page = await open({ viewport: { width: 1000, height: 800 } }, null, "#/search");
  const r = await page.evaluate(async () => {
    const inp = document.querySelector(".search-box input");
    inp.value = "biometric";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((x) => setTimeout(x, 700));
    return { hit: /Biometric Lock/.test(document.querySelector(".view").innerText), supported: !!(G.biometric && G.biometric.supported()) };
  });
  check(r.supported === false && r.hit === false, "C7: a browser/PC build does not offer Biometric Lock in search", JSON.stringify(r));
  await page.context().close();
}

await browser.close();
server.close();
if (noise.length) console.log("  note: " + noise.length + " page error(s): " + noise.slice(0, 3).join(" | "));
console.log(fails ? "\n" + fails + " FAILED" : "\nAll passed");
process.exit(fails ? 1 : 0);
