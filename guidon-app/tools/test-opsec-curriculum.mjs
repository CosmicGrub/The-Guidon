/**
 * Cybersecurity & OPSEC curriculum (src/app-modules/06-opsec-cyber-curriculum.js)
 * through the real built page.
 *
 *  1. DICTIONARY - the curriculum ADDS meanings, it never replaces one. It
 *     used to overwrite 11 existing entries: "AO" lost "area of operations"
 *     (searching the Dictionary for "area of operations" found nothing),
 *     "ATO" lost "air tasking order; antiterrorism officer", and all 20
 *     entries it touched carried a source tag the Dictionary did not know,
 *     so they were badged JOINT - including terms such as CMMC and MFA that
 *     are not joint-dictionary terms at all.
 *  2. BOARD BANK - no two cards ask the identical prompt (the module's first
 *     card repeated the seed's "What is OPSEC?" with a different answer).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];
async function open(viewport, tag) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(`${tag} ${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => noise.push(`${tag} pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  return page;
}
const page = await open({ width: 1200, height: 900 }, "[main]");

/* ======================================================================
   1. DICTIONARY
   ====================================================================== */
await page.evaluate(() => { location.hash = "#/dictionary"; });
await page.waitForSelector('input[aria-label="Search dictionary"]', { timeout: 10000 });
const defaultFirst = await page.evaluate(() => (document.querySelector(".list-detail-row") || { getAttribute: () => null }).getAttribute("data-term"));
async function lookUp(text) {
  // The search box is debounced, and a route that has only just drawn can be
  // drawn once more as content settles (which hands back an empty box) - so
  // type, wait, and confirm the box still holds the query and the list moved.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.fill('input[aria-label="Search dictionary"]', text);
    await page.waitForTimeout(500);
    const settled = await page.evaluate(([t, first]) => {
      const box = document.querySelector('input[aria-label="Search dictionary"]');
      const row = document.querySelector(".list-detail-row");
      return !!box && box.value === t && (!row || row.getAttribute("data-term") !== first);
    }, [text, defaultFirst]);
    if (settled) break;
  }
  return page.evaluate(() => Array.from(document.querySelectorAll(".list-detail-row")).map((r) => ({
    term: r.getAttribute("data-term"), badge: (r.querySelector(".ldr-badge") || {}).textContent })));
}
async function openTerm(term) {
  const rows = await lookUp(term);
  const hit = rows.find((r) => r.term === term);
  if (!hit) return { rows, detail: null, badge: null };
  await page.evaluate((t) => { const r = Array.from(document.querySelectorAll(".list-detail-row")).find((x) => x.getAttribute("data-term") === t); if (r) r.click(); }, term);
  await page.waitForTimeout(200);
  const detail = await page.evaluate(() => (document.getElementById("dictionary-detail-pane") || {}).textContent || "");
  return { rows, detail: detail.replace(/\s+/g, " ").trim(), badge: hit.badge };
}

let rows = await lookUp("area of operations");
rows.some((r) => r.term === "AO")
  ? ok('searching the Dictionary for "area of operations" finds AO again')
  : bad('"area of operations" does not find AO: ' + JSON.stringify(rows.slice(0, 6)));

const ao = await openTerm("AO");
(ao.detail && /action officer/.test(ao.detail) && /air officer/.test(ao.detail) && /area of operations/.test(ao.detail) && /Authorizing Official/.test(ao.detail))
  ? ok("AO shows every meaning it had (action officer; air officer; area of operations) plus the added Authorizing Official")
  : bad("AO detail: " + JSON.stringify(ao.detail));
(ao.detail && ao.detail.indexOf("area of operations") < ao.detail.indexOf("Authorizing Official")) ? ok("...with the original meanings first") : bad("AO meaning order: " + JSON.stringify(ao.detail));
ao.badge === "ARMY+JOINT" ? ok("AO keeps its ARMY+JOINT source badge") : bad("AO badge: " + ao.badge);

const ato = await openTerm("ATO");
(ato.detail && /air tasking order/.test(ato.detail) && /antiterrorism officer/.test(ato.detail) && /Authorization to Operate/.test(ato.detail) && ato.badge === "ARMY+JOINT")
  ? ok("ATO keeps \"air tasking order; antiterrorism officer\", gains Authorization to Operate, badge unchanged")
  : bad("ATO: " + JSON.stringify(ato));
const pii = await openTerm("PII");
(pii.detail && /pre-incident indicators/.test(pii.detail) && /Personally Identifiable Information/.test(pii.detail)) ? ok("PII keeps its seed meaning and gains Personally Identifiable Information") : bad("PII: " + JSON.stringify(pii.detail));
const opsec = await openTerm("OPSEC");
(opsec.badge === "ARMY+JOINT" && /Operations Security/i.test(opsec.detail || "")) ? ok("OPSEC (one meaning, fuller wording) keeps its ARMY+JOINT badge") : bad("OPSEC: " + JSON.stringify(opsec));

const vocab = await page.evaluate(() => {
  const counts = {};
  window.G.store.acronyms().terms.forEach((t) => { counts[t.src] = (counts[t.src] || 0) + 1; });
  return counts;
});
Object.keys(vocab).every((k) => k === "army" || k === "both")
  ? ok("every dictionary entry carries a source tag the Dictionary knows: " + JSON.stringify(vocab))
  : bad("unknown source tags in the running dictionary: " + JSON.stringify(vocab));
const cmmc = await openTerm("CMMC");
(cmmc.badge && cmmc.badge !== "JOINT" && /Cybersecurity Maturity Model Certification/.test(cmmc.detail || ""))
  ? ok(`an added term (CMMC) is no longer badged as a joint-dictionary term (badge: ${cmmc.badge})`)
  : bad("CMMC: " + JSON.stringify(cmmc));

/* ======================================================================
   2. BOARD BANK - no identical prompts
   ====================================================================== */
const dups = await page.evaluate(() => {
  const seen = new Map(), out = [];
  ((window.GUIDON_SEED.board || {}).questions || []).forEach((q) => {
    const k = String(q.q || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(k)) out.push(q.q + " (" + seen.get(k) + " / " + q.id + ")"); else seen.set(k, q.id);
  });
  return { out, total: seen.size };
});
dups.out.length === 0
  ? ok(`no two of the ${dups.total} board cards ask the identical prompt`)
  : bad("identical prompts: " + dups.out.join(" | "));

/* __MORE__ */

noise.length === 0 ? ok("no console errors/warnings or page errors") : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nOPSEC CURRICULUM: all passed" : `\nOPSEC CURRICULUM: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
