/**
 * The squad roster is the only data in GUIDON about people other than the user.
 * Backup files get emailed. This asserts the roster does not ride along by
 * default, and that including it is possible but deliberate.
 *
 * P1 of the "No server, ever" promise (desktop roadmap, locked decision Q1)
 * adds five more cases, all against the same one browser:
 *   (1) the in-app #/privacy sections are verbatim copies of the paragraphs
 *       under the same headings in "GUIDON files/PRIVACY.md" - both ways -
 *       and the "Last updated" date is the same in both. The only mapping
 *       applied is markdown syntax (** and backticks are stripped, "- "
 *       bullets are paragraphs) plus typographic quotes folded to straight
 *       ones; em dashes, arrows and every word must match exactly. Nobody
 *       hand-maintains the copy: this is what keeps the two in step.
 *   (2) the promise names all four network exceptions - LAN/hotspot study
 *       rooms, GitHub Pages delivery, OS voice-pack downloads, iCloud/device
 *       backups - in #/privacy, PRIVACY.md and the root README.md.
 *   (3) no user-facing text credits a Content Security Policy the app does
 *       not ship (no build carries one; tools/test-csp.mjs's header is
 *       test-only and exempt).
 *   (4) the study-groups kill switch defaults OFF and the Settings toggle
 *       labelled "Study groups (LAN rooms)" really flips the setting.
 *   (5) G.netLedger exists (record/list/clear, empty on a fresh page) and the
 *       Diagnostics "No external requests" check reads it: a planted
 *       connection FAILS the check by name while the switch is off, and is
 *       counted in its detail while the switch is on.
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
// GUIDON_WEB_DIR / PRIVACY_MD / README_MD: optional overrides so the
// verifier can be verified against scratch copies (mutate a paragraph, drop
// "GitHub Pages", add a CSP claim) without touching the real files.
const { server, url } = await serve(process.env.GUIDON_WEB_DIR || "web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(url, { waitUntil: "load" }); await page.waitForTimeout(700);

// Seed a roster entry and an ordinary user-data key.
await page.evaluate(async () => {
  await G.db.put("kv", { k: "guidon:leader:roster:v1", v: [{ rank:"SPC", name:"J.R.", counseled:"2026-06-01" }] });
  await G.db.put("kv", { k: "guidon:probe:mine", v: { ok: true } });
});
await page.waitForTimeout(400);

const def = await page.evaluate(async () => {
  const p = await G.backup.exportAll();
  const keys = (p.stores.kv || []).map(r => r.k);
  return { keys, excluded: p.excludedPrivateEntries, flag: p.includesOtherPeoplesData,
           raw: JSON.stringify(p) };
});
!def.keys.includes("guidon:leader:roster:v1")
  ? ok("default export EXCLUDES the squad roster") : bad("roster present in default export");
def.keys.includes("guidon:probe:mine")
  ? ok("default export still includes the user's own data") : bad("user data was dropped");
def.excluded === 1 ? ok("export reports 1 excluded private entry") : bad("excluded count = " + def.excluded);
def.flag === false ? ok("payload flags includesOtherPeoplesData = false") : bad("flag = " + def.flag);
!/J\.R\./.test(def.raw) ? ok("no roster initials anywhere in the default payload") : bad("initials leaked into payload");

const opt = await page.evaluate(async () => {
  const p = await G.backup.exportAll({ includePrivate: true });
  return { keys: (p.stores.kv||[]).map(r=>r.k), flag: p.includesOtherPeoplesData };
});
opt.keys.includes("guidon:leader:roster:v1")
  ? ok("opt-in export CAN include the roster when explicitly requested") : bad("opt-in did not include roster");
opt.flag === true ? ok("opt-in payload flags includesOtherPeoplesData = true") : bad("opt-in flag = " + opt.flag);

await page.evaluate(async () => { await G.db.del ? 0 : 0; });

/* ======================================================================
   P1: the promise, the switch and the ledger.
   ====================================================================== */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const PRIVACY_MD = process.env.PRIVACY_MD || path.join(REPO, "GUIDON files", "PRIVACY.md");
const README_MD = process.env.README_MD || path.join(REPO, "README.md");
const md = await readFile(PRIVACY_MD, "utf-8");
const readme = await readFile(README_MD, "utf-8");

// The one deterministic mapping between markdown source and rendered text.
const norm = (s) => String(s)
  .replace(/\*\*/g, "").replace(/`/g, "")
  .replace(/[\u201c\u201d]/g, "\"").replace(/[\u2018\u2019]/g, "'")
  .replace(/\s+/g, " ").trim();

// "## Heading" starts a section; blank lines separate paragraphs; a "- "
// line is one paragraph of its own; parsing stops at the first "---" rule
// (the Play Store submission note below it is not policy text and the app
// deliberately does not render it).
function mdSections(text) {
  const out = []; let cur = null; let buf = [];
  const flush = () => { if (cur && buf.length) cur.p.push(buf.join(" ")); buf = []; };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^---\s*$/.test(line)) { flush(); break; }
    if (line.startsWith("## ")) { flush(); cur = { h: line.slice(3).trim(), p: [] }; out.push(cur); continue; }
    if (!cur) continue;
    if (!line.trim()) { flush(); continue; }
    if (/^- /.test(line)) { flush(); buf.push(line.replace(/^- /, "")); flush(); continue; }
    buf.push(line.trim());
  }
  flush();
  return out;
}
const mdSecs = mdSections(md);
const mdUpdated = (md.match(/\*\*Last updated:\*\*\s*([^\n]+)/) || [])[1] || "";

// Onboarding overlay: the DOM-driven cases below need the real views.
await dismissOnboarding(page);
await page.waitForTimeout(300);

// ---- (1) in-app privacy text equals PRIVACY.md ----
await page.evaluate(() => { location.hash = "#/privacy"; });
await page.waitForTimeout(500);
const app = await page.evaluate(() => {
  const root = document.querySelector("#view, main") || document.body;
  const secs = [];
  root.querySelectorAll(".panel").forEach((pn) => {
    const h = pn.querySelector("h3");
    if (!h) return;
    secs.push({ h: h.textContent, p: Array.from(pn.querySelectorAll("p.hint")).map((x) => x.textContent) });
  });
  const updated = Array.from(root.querySelectorAll("p.hint")).map((x) => x.textContent).find((t) => /^Last updated/.test(t)) || "";
  return { secs, updated, text: root.textContent || "" };
});
const appText = app.secs.map((s) => s.h + "\n" + s.p.join("\n")).join("\n");
{
  let mism = [];
  const appH = app.secs.map((s) => norm(s.h)), mdH = mdSecs.map((s) => norm(s.h));
  if (appH.join("|") !== mdH.join("|")) mism.push(`heading list differs\n           app: ${appH.join(" | ")}\n           md:  ${mdH.join(" | ")}`);
  for (const s of app.secs) {
    const m = mdSecs.find((x) => norm(x.h) === norm(s.h));
    if (!m) { mism.push(`no PRIVACY.md section for app heading "${s.h}"`); continue; }
    const a = s.p.map(norm), b = m.p.map(norm);
    if (a.length !== b.length) mism.push(`"${s.h}": app has ${a.length} paragraph(s), PRIVACY.md has ${b.length}`);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) { mism.push(`"${s.h}" paragraph ${i + 1} differs\n           app: ${a[i]}\n           md:  ${b[i]}`); break; }
  }
  mism.length === 0 && app.secs.length > 0
    ? ok(`(1) #/privacy renders ${app.secs.length} sections, ${app.secs.reduce((n, s) => n + s.p.length, 0)} paragraphs, each a verbatim copy of PRIVACY.md and vice versa`)
    : bad(`(1) #/privacy and PRIVACY.md differ (${mism.length}); first: ${mism[0]}`);
  mdUpdated && app.updated.includes(mdUpdated)
    ? ok(`(1) "Last updated" agrees: ${mdUpdated}`)
    : bad(`(1) "Last updated" differs: PRIVACY.md "${mdUpdated}" vs app "${app.updated}"`);
}

// ---- (2) the promise names all four exceptions, in all three places ----
{
  const PHRASES = [
    ["LAN/hotspot study rooms", /\bLAN rooms\b/i],
    ["GitHub Pages delivery", /\bGitHub Pages\b/i],
    ["OS voice-pack download", /\bvoice pack\b/i],
    ["iCloud / device backups", /\biCloud\b|\bdevice backups?\b/i],
  ];
  for (const [where, text] of [["#/privacy", appText], ["PRIVACY.md", md], ["README.md", readme]]) {
    const missing = PHRASES.filter(([, re]) => !re.test(text)).map(([n]) => n);
    missing.length === 0 ? ok(`(2) ${where} names all four exceptions`) : bad(`(2) ${where} is missing: ${missing.join(", ")}`);
  }
}

// ---- (3) no unshipped CSP claim ----
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(500);
const aboutText = await page.evaluate(() => {
  const pn = Array.from(document.querySelectorAll(".panel")).find((p) => /About GUIDON/.test((p.querySelector(".fin-h") || {}).textContent || ""));
  return pn ? Array.from(pn.querySelectorAll("p.hint")).map((x) => x.textContent).join("\n") : "";
});
{
  const BANNED = [/connect-src/i, /content[- ]security[- ]policy/i, /\bCSP\b/];
  for (const [where, text] of [["PRIVACY.md", md], ["README.md", readme], ["#/privacy", appText], ["About hint", aboutText]]) {
    const hit = BANNED.map((re) => (text.match(re) || [])[0]).filter(Boolean);
    if (!text) { bad(`(3) ${where}: no text found to check`); continue; }
    hit.length === 0 ? ok(`(3) ${where} credits no CSP`) : bad(`(3) ${where} mentions ${hit.join(", ")} - no shipped build carries a CSP`);
  }
}

// ---- (4) kill switch default off + a real Settings toggle ----
{
  const fresh = await page.evaluate(() => G.store.settings().studyGroups);
  fresh === false ? ok("(4) studyGroups defaults to false on a fresh profile") : bad("(4) studyGroups default = " + JSON.stringify(fresh));
  const LABEL = "Study groups (LAN rooms)";
  const found = await page.evaluate((label) => {
    const sw = Array.from(document.querySelectorAll(".switch")).find((s) => (s.querySelector("span:not(.track)") || {}).textContent === label);
    return sw ? !!sw.querySelector("input[type=checkbox]") : false;
  }, LABEL);
  found ? ok(`(4) Settings renders a toggle labelled "${LABEL}"`) : bad(`(4) no Settings toggle labelled "${LABEL}"`);
  if (found) {
    const flip = async () => {
      await page.evaluate((label) => {
        const sw = Array.from(document.querySelectorAll(".switch")).find((s) => (s.querySelector("span:not(.track)") || {}).textContent === label);
        sw.querySelector("input[type=checkbox]").click();
      }, LABEL);
      await page.waitForTimeout(150);
      return page.evaluate(() => G.store.settings().studyGroups);
    };
    const on = await flip();
    on === true ? ok("(4) toggling ON writes studyGroups = true") : bad("(4) after toggle ON studyGroups = " + JSON.stringify(on));
    const off = await flip();
    off === false ? ok("(4) toggling OFF writes studyGroups = false") : bad("(4) after toggle OFF studyGroups = " + JSON.stringify(off));
  }
}

// ---- (5) the ledger and the Diagnostics offline check ----
{
  const shape = await page.evaluate(() => {
    const l = window.G && window.G.netLedger;
    return l ? { record: typeof l.record, list: typeof l.list, clear: typeof l.clear, fresh: JSON.stringify(l.list()) } : null;
  });
  shape && shape.record === "function" && shape.list === "function" && shape.clear === "function"
    ? ok("(5) window.G.netLedger exposes record/list/clear") : bad("(5) G.netLedger missing or wrong shape: " + JSON.stringify(shape));
  shape && shape.fresh === "[]" ? ok("(5) ledger is empty on a fresh page") : bad("(5) fresh ledger = " + (shape && shape.fresh));

  await page.evaluate(() => { location.hash = "#/selftest"; });
  await page.waitForTimeout(500);
  const CHECK = /No external requests/;
  async function runOffline() {
    await page.evaluate(() => document.querySelectorAll(".panel .card").forEach((c) => c.setAttribute("data-stale", "1")));
    await page.locator("button", { hasText: /Run automated checks|Run again/ }).first().click();
    await page.waitForFunction((src) => {
      const re = new RegExp(src);
      const c = Array.from(document.querySelectorAll(".panel .card")).find((x) => re.test(x.textContent || ""));
      return !!c && !c.hasAttribute("data-stale");
    }, CHECK.source, { timeout: 20000 }).catch(() => {});
    return page.evaluate((src) => {
      const re = new RegExp(src);
      const c = Array.from(document.querySelectorAll(".panel .card")).find((x) => re.test(x.textContent || ""));
      if (!c) return null;
      return { ok: /^\u2713/.test((c.querySelector(".ob-plan-cat") || {}).textContent || ""),
               detail: ((c.querySelectorAll(".hint")[0] || {}).textContent) || "" };
    }, CHECK.source);
  }
  const base = await runOffline();
  base && base.ok ? ok("(5) offline check passes on a fresh page: " + base.detail) : bad("(5) baseline offline check: " + JSON.stringify(base));

  const PEER = "192.168.43.1:7777";
  if (!shape) {
    bad("(5) cannot plant a connection: G.netLedger is absent (studyGroups OFF branch untested)");
    bad("(5) cannot plant a connection: G.netLedger is absent (studyGroups ON branch untested)");
    bad("(5) cannot test clear(): G.netLedger is absent");
  } else {
    await page.evaluate(async (peer) => {
      await G.store.setSetting("studyGroups", false);
      G.netLedger.record({ kind: "ws", peer, at: Date.now() });
    }, PEER);
    const planted = await runOffline();
    planted && planted.ok === false && planted.detail.includes(PEER)
      ? ok("(5) with studyGroups OFF a planted connection FAILS the check by name: " + planted.detail)
      : bad("(5) planted connection with studyGroups OFF: " + JSON.stringify(planted));

    await page.evaluate(async () => { await G.store.setSetting("studyGroups", true); });
    const allowed = await runOffline();
    allowed && allowed.ok === true && /\b1 session connection\b/.test(allowed.detail)
      ? ok("(5) with studyGroups ON the check passes and reports it: " + allowed.detail)
      : bad("(5) planted connection with studyGroups ON: " + JSON.stringify(allowed));

    await page.evaluate(async () => { G.netLedger.clear(); await G.store.setSetting("studyGroups", false); });
    const cleared = await page.evaluate(() => JSON.stringify(G.netLedger.list()));
    cleared === "[]" ? ok("(5) clear() empties the ledger") : bad("(5) after clear() ledger = " + cleared);
  }
}

await browser.close(); server.close();
console.log("\n" + (fails ? `PRIVACY: ${fails} FAILURE(S)` : "PRIVACY: all passed"));
process.exit(fails ? 1 : 0);
