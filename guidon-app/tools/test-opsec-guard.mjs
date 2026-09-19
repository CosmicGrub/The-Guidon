/**
 * Sensitive-text check (G.opsecGuard, src/app-modules/05-opsec-guard.js) -
 * FINDINGS ONLY, proven through the real built page.
 *
 * The first guard both decided and rewrote. Its Social Security pattern
 * matched "600-20 2020", so "AR 600-20 2020" reached MOI Import's citation
 * parser as "AR [SSN REDACTED]" and the assigned regulation silently dropped
 * out of the Soldier's study plan; the one notice it wrote was destroyed in
 * the same tick. Its marking patterns were case-insensitive English words, so
 * the app's own CUI cards and the standard AR 380-5 board question were
 * hard-stopped with an incident-reporting instruction while "(S//NF)" and
 * "UNCLASSIFIED//FOUO" passed. Its "future date" was the literal years
 * 2027-2099 in two civilian typographies.
 *
 * What this suite holds the replacement to:
 *  1. FIXTURES - tools/fixtures/opsec-guard-cases.json, a table of inputs
 *     (legitimate study text, grid coordinates, publication numbers, ten-digit
 *     numbers in forms, real marking syntax, labelled identifiers, future
 *     movements in every date format Soldiers write) with the exact findings
 *     each must produce. Dates are filled from the real clock, so no row
 *     depends on a particular year. screen() must hand back the text
 *     character-for-character every time.
 *  2. CORPUS - the app's own content (every board card incl. the ones the
 *     app-modules add, every scenario, every doctrine entry, every dictionary
 *     term) must never be stopped and never read as an ID number.
 *  3. MOI IMPORT, through the real UI - citations followed by a year all
 *     survive to Review; a POC phone/email line raises a notice that is
 *     still on screen seconds later, until dismissed, and follows the Soldier
 *     onto the built plan; real marking syntax stops the import, names the
 *     line, leaves the pasted text untouched and gives focus somewhere real;
 *     a future movement pauses and asks (Continue / Go back) instead of
 *     dead-ending; a plain board date sails through; nothing the check
 *     flagged is written into the saved plan.
 *  4. SQUAD ROSTER, through the real UI - a phone number typed into the
 *     initials field is not saved, stays as typed, and a plain message stays
 *     under the field (tied to it for screen readers) until the entry is
 *     fixed.
 *  5. No horizontal overflow at 390px with a notice on screen; zero console
 *     noise.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

/* ---- date tokens from the real clock ---- */
const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const p2 = (n) => String(n).padStart(2, "0");
function forms(d) {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  return {
    ISO: `${y}-${p2(m + 1)}-${p2(day)}`,
    US: `${m + 1}/${day}/${y}`,
    LONG: `${MONTHS[m]} ${day}, ${y}`,
    ARMY: `${day} ${MON3[m]} ${y}`,
    ARMY2: `${day} ${MON3[m]} ${String(y).slice(2)}`,
    DTG: `${p2(day)}0600Z${MON3[m]}${String(y).slice(2)}`,
  };
}
const today = new Date();
const at = (days) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
const TOKENS = { SOON: forms(at(1)), FAR: forms(at(396)), PAST: forms(at(-42)) };
const fill = (s) => s.replace(/\{\{(SOON|FAR|PAST)_([A-Z0-9]+)\}\}/g, (_, when, form) => {
  const v = TOKENS[when][form];
  if (v == null) throw new Error("unknown date token " + when + "_" + form);
  return v;
});

const FIXTURES = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/opsec-guard-cases.json", import.meta.url)), "utf8"));
const CASES = FIXTURES.cases.map((c) => Object.assign({}, c, { text: fill(c.text) }));

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
   1. FIXTURES
   ====================================================================== */
const api = await page.evaluate(() => ({
  screen: typeof (window.G.opsecGuard || {}).screen,
  oldSanitize: typeof (window.G.opsecGuard || {}).sanitizeInput,
  utilSanitize: typeof (window.G.util || {}).sanitizeInput,
}));
api.screen === "function" ? ok("G.opsecGuard.screen() exists in the built page") : bad("G.opsecGuard.screen is " + api.screen);
(api.oldSanitize === "undefined" && api.utilSanitize === "undefined")
  ? ok("the text-rewriting API (sanitizeInput) is gone - there is no code path left that hands a caller edited text")
  : bad("a rewriting API is still exported: opsecGuard.sanitizeInput=" + api.oldSanitize + ", util.sanitizeInput=" + api.utilSanitize);

const results = await page.evaluate((cases) => cases.map((c) => {
  const r = window.G.opsecGuard.screen(c.text);
  return { same: r.text === c.text, stop: r.stop, check: r.check, note: r.note, clean: r.clean,
    findings: r.findings.map((f) => ({ code: f.code, severity: f.severity, excerpt: f.excerpt, line: f.line, slice: c.text.slice(f.start, f.end), looksLike: f.looksLike })) };
}), CASES);

let fixtureFails = 0;
CASES.forEach((c, i) => {
  const r = results[i];
  const got = Array.from(new Set(r.findings.map((f) => f.code))).sort().join(","); // a header AND a footer banner are two findings of one code
  const want = c.expect.slice().sort().join(",");
  const problems = [];
  if (got !== want) problems.push(`findings [${got}] expected [${want}]`);
  if (!r.same) problems.push("screen() changed the text");
  if (c.severity && r.findings.some((f) => f.severity !== c.severity)) problems.push("severity " + r.findings.map((f) => f.severity).join(",") + " expected " + c.severity);
  if (c.excerpt && !r.findings.some((f) => f.excerpt.includes(c.excerpt))) problems.push(`no finding excerpt contains "${c.excerpt}": ${JSON.stringify(r.findings.map((f) => f.excerpt))}`);
  if (r.findings.some((f) => !f.looksLike || !f.excerpt || !(f.line >= 1))) problems.push("a finding lacks its plain-language description, excerpt or line number");
  if (problems.length) { fixtureFails++; bad(`fixture "${c.name}": ${problems.join("; ")}  <<${c.text.replace(/\n/g, "\\n").slice(0, 110)}>>`); }
});
fixtureFails === 0
  ? ok(`all ${CASES.length} fixture rows produce exactly their expected findings, and screen() returns every input character-for-character`)
  : bad(`${fixtureFails} of ${CASES.length} fixture rows failed`);

// The masked excerpt locates an ID number without repeating it.
const ssnRow = results[CASES.findIndex((c) => c.name === "SSN labelled")];
(ssnRow && ssnRow.findings[0] && !/123-45/.test(ssnRow.findings[0].excerpt) && /6789/.test(ssnRow.findings[0].excerpt))
  ? ok(`a Social Security number's excerpt shows only its last four digits ("${ssnRow.findings[0].excerpt}")`)
  : bad("SSN excerpt is not masked: " + JSON.stringify(ssnRow && ssnRow.findings));

// The clock, not a year written into the source: the same sentence flips from
// "future" to "past" purely on options.now.
const clock = await page.evaluate(() => {
  const s = "Deployment movement on 2031-05-20 at Fort Example training area";
  const codes = (now) => window.G.opsecGuard.screen(s, { now: now }).findings.map((f) => f.code);
  return { before: codes(new Date(2031, 4, 19).getTime()), onTheDay: codes(new Date(2031, 4, 20, 15).getTime()), after: codes(new Date(2031, 4, 21).getTime()) };
});
(clock.before.length === 1 && clock.onTheDay.length === 1 && clock.after.length === 0)
  ? ok("'future' is decided against the clock: 2031-05-20 is flagged the day before and on the day, and not the day after")
  : bad("clock comparison: " + JSON.stringify(clock));

/* ======================================================================
   2. CORPUS - the app's own content never trips a stop or an ID finding
   ====================================================================== */
const corpus = await page.evaluate(() => {
  const S = window.GUIDON_SEED || {};
  const texts = [];
  const push = (kind, id, parts) => { const t = parts.filter((x) => typeof x === "string" && x).join("\n"); if (t) texts.push({ kind, id, t }); };
  ((S.board && S.board.questions) || []).forEach((q) => push("card", q.id, [q.q, q.a, q.boardAnswer].concat(q.keyPoints || [])));
  ((S.scenarios && S.scenarios.scenarios) || []).forEach((s) => {
    const parts = [s.title, s.scene];
    Object.keys(s.nodes || {}).forEach((k) => { const n = s.nodes[k]; parts.push(n.prompt, n.outcome); (n.choices || []).forEach((c) => parts.push(c.text, c.feedback)); });
    push("scenario", s.id, parts);
  });
  const doc = S.doctrine && (S.doctrine.entries || S.doctrine.doctrine || S.doctrine.items);
  (Array.isArray(doc) ? doc : []).forEach((d) => push("doctrine", d.id, [d.title, d.summary, d.body, d.text].concat(Array.isArray(d.keyPoints) ? d.keyPoints : [])));
  ((S.acronyms && S.acronyms.terms) || []).forEach((t) => push("term", t.a, [t.a + " - " + t.d]));
  const counts = {}, stops = [], ids = [];
  let checks = 0;
  texts.forEach((x) => {
    counts[x.kind] = (counts[x.kind] || 0) + 1;
    const r = window.G.opsecGuard.screen(x.t);
    r.findings.forEach((f) => {
      if (f.severity === "stop") stops.push(x.kind + " " + x.id + " [" + f.code + "] " + f.excerpt);
      else if (f.code === "ssn" || f.code === "dod-id") ids.push(x.kind + " " + x.id + " [" + f.code + "] " + f.excerpt);
      else if (f.severity === "check") checks++;
    });
  });
  return { counts, stops, ids, checks };
});
(corpus.counts.card > 1000 && corpus.counts.scenario > 100 && corpus.counts.term > 3000)
  ? ok(`corpus swept: ${JSON.stringify(corpus.counts)}`)
  : bad("corpus looks too small to mean anything: " + JSON.stringify(corpus.counts));
corpus.stops.length === 0
  ? ok("none of the app's own cards, scenarios, doctrine entries or dictionary terms is stopped as marked material (the first guard stopped 10 cards and 6 scenarios)")
  : bad(`${corpus.stops.length} pieces of the app's own content are stopped: ${corpus.stops.slice(0, 8).join(" | ")}`);
corpus.ids.length === 0
  ? ok("none of the app's own content reads as a Social Security or DoD ID number")
  : bad(`${corpus.ids.length} pieces of the app's own content read as an ID number: ${corpus.ids.slice(0, 8).join(" | ")}`);

/* ======================================================================
   3. MOI IMPORT through the real UI
   ====================================================================== */
const clickButton = (pg, re) => pg.evaluate((src) => {
  const rx = new RegExp(src);
  const b = [...document.querySelectorAll("button")].find((x) => rx.test((x.textContent || "").trim()));
  if (b) { b.click(); return true; }
  return false;
}, re.source);
async function openCapture(pg) {
  await pg.evaluate(async () => { await window.G.db.put("kv", { k: window.G.moiImport.KEY, v: null }); });
  await pg.evaluate(() => { location.hash = "#/home"; });
  await pg.waitForTimeout(200);
  await pg.evaluate(() => { location.hash = "#/moi"; });
  await pg.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Import an MOI/.test(b.textContent || "")), null, { timeout: 10000 });
  await clickButton(pg, /Import an MOI/);
  await pg.waitForSelector("textarea", { timeout: 5000 });
}
async function pasteAndFind(pg, text) {
  await pg.evaluate((t) => { const ta = document.querySelector("textarea"); ta.value = t; ta.dispatchEvent(new Event("input", { bubbles: true })); }, text);
  await clickButton(pg, /Find my topics/);
}
// The heading element, never body.textContent: the built page's inline scripts are part of <body>'s text.
const reviewHeading = () => [...document.querySelectorAll("h3")].some((h) => /Review your matches/.test(h.textContent || ""));
const onReview = (pg, ms) => pg.waitForFunction(reviewHeading, null, { timeout: ms || 8000 }).then(() => true, () => false);
const reviewSummary = (pg) => pg.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => /Review your matches/.test(h.textContent || ""));
  return h3 && h3.nextElementSibling ? h3.nextElementSibling.textContent : null;
});
const notice = (pg) => pg.evaluate(() => {
  const n = document.querySelector("[data-moi-guard]");
  if (!n) return null;
  const r = n.getBoundingClientRect();
  const a = document.activeElement;
  return { kind: n.getAttribute("data-moi-guard"), text: n.textContent.replace(/\s+/g, " ").trim(), visible: r.width > 0 && r.height > 0,
    buttons: [...n.querySelectorAll("button")].map((b) => b.textContent.trim()),
    focusInside: !!(a && n.contains(a)), focusIsBody: a === document.body };
});
const liveText = (pg) => pg.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");

/* 3a - a regulation followed by its year is a citation, not an ID number */
await openCapture(page);
await pasteAndFind(page, "AR 600-20 2020\nAR 600-25 2019\nAR 635-200 2021\nADP 6-22");
(await onReview(page)) ? ok("(reg + year) the import reaches Review") : bad("(reg + year) Review never appeared");
let summary = await reviewSummary(page);
(summary && /^4 matched · 0 need a look · 0 not found/.test(summary))
  ? ok(`(reg + year) all four assigned publications match: "${summary}" (the first guard handed the parser "AR [SSN REDACTED]" and kept one)`)
  : bad(`(reg + year) summary: "${summary}" - expected 4 matched`);
const shown = await page.evaluate(() => { const h = [...document.querySelectorAll("h3")].find((x) => /Review your matches/.test(x.textContent || "")); return h && h.parentNode ? h.parentNode.textContent : ""; });
["AR 600-20", "AR 600-25", "AR 635-200", "ADP 6-22"].every((c) => shown.includes(c))
  ? ok("(reg + year) every citation is listed on Review")
  : bad("(reg + year) a citation is missing from Review: " + ["AR 600-20", "AR 600-25", "AR 635-200", "ADP 6-22"].filter((c) => !shown.includes(c)).join(", "));
(await notice(page)) === null ? ok("(reg + year) and nothing is flagged - there is nothing sensitive in a reference list") : bad("(reg + year) an unexpected notice: " + JSON.stringify(await notice(page)));

/* 3a' - the two-column "Reference | Date" PDF table read as one line */
await openCapture(page);
await pasteAndFind(page, "Reference Date AR 600-20 2020 AR 600-25 2019 AR 635-200 2021 ADP 6-22 2019");
await onReview(page);
summary = await reviewSummary(page);
(summary && /^4 matched/.test(summary)) ? ok(`(PDF table row) all four survive: "${summary}"`) : bad(`(PDF table row) summary: "${summary}"`);

/* 3b - routine contact details: mentioned, never edited, notice stays until dismissed */
const POC_MOI = [
  "LEADERSHIP:",
  "Study ADP 6-22 thoroughly before the board.",
  "",
  "POC SSG DOE 270-555-0101:",
  "Review AR 623-3 before the board. Questions to jane.doe@army.mil.",
].join("\n");
await openCapture(page);
await pasteAndFind(page, POC_MOI);
(await onReview(page)) ? ok("(POC line) a phone number and an email do not stop the import") : bad("(POC line) Review never appeared");
let n = await notice(page);
(n && n.kind === "note" && n.visible && /a phone number and an email address/.test(n.text))
  ? ok(`(POC line) Review carries a plain notice: "${n.text.slice(0, 120)}…"`)
  : bad("(POC line) no notice on Review: " + JSON.stringify(n));
(n && !/270-555-0101|jane\.doe/.test(n.text)) ? ok("(POC line) the notice does not repeat the phone number or the address") : bad("(POC line) the notice repeats the details: " + (n && n.text));
(n && !/redact|aggregation|pattern|sanitiz|regex/i.test(n.text)) ? ok("(POC line) ...and is free of engineering words") : bad("(POC line) jargon in the notice: " + (n && n.text));
await page.waitForTimeout(150);
/a phone number and an email address/.test(await liveText(page)) ? ok("(POC line) the notice is announced through the app's live region") : bad("(POC line) live region reads: " + (await liveText(page)));
await page.waitForTimeout(3000);
n = await notice(page);
(n && n.visible) ? ok("(POC line) three seconds later the notice is still on screen (the first one was wiped in the tick it was written)") : bad("(POC line) the notice did not stay");
summary = await reviewSummary(page);
(summary && /^2 matched/.test(summary)) ? ok(`(POC line) both publications still match: "${summary}"`) : bad(`(POC line) summary: "${summary}"`);

await clickButton(page, /^Build/);
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^Replace$/.test((b.textContent || "").trim())), null, { timeout: 8000 }).catch(() => {});
n = await notice(page);
(n && n.kind === "note" && n.visible) ? ok("(POC line) built without dismissing it - the notice follows onto the finished plan") : bad("(POC line) the notice was lost on Build: " + JSON.stringify(n));
const savedPlan = await page.evaluate(async () => { const r = await window.G.db.get("kv", window.G.moiImport.KEY); return r && r.v ? JSON.stringify(r.v) : null; });
(savedPlan && !/270-555-0101|jane\.doe|SSG DOE/.test(savedPlan))
  ? ok("(POC line) the saved plan holds no phone number, address or name from the flagged line")
  : bad("(POC line) flagged text was written into the saved plan: " + (savedPlan || "").slice(0, 300));
(savedPlan && /LEADERSHIP/.test(savedPlan) && /General/.test(savedPlan))
  ? ok("(POC line) the clean heading is kept and the flagged one's topics fall under \"General\" - left out, not rewritten")
  : bad("(POC line) plan groups: " + (savedPlan || "").slice(0, 300));
await page.evaluate(() => { const b = [...document.querySelectorAll("[data-moi-guard] button")].find((x) => /Dismiss/.test(x.textContent)); if (b) b.click(); });
await page.waitForTimeout(100);
n = await notice(page);
const focusAfterDismiss = await page.evaluate(() => document.activeElement === document.body ? "body" : document.activeElement.tagName);
(n === null && focusAfterDismiss !== "body") ? ok(`(POC line) Dismiss removes it and focus lands on the plan (${focusAfterDismiss}), not the page body`) : bad(`(POC line) after Dismiss: notice=${JSON.stringify(n)} focus=${focusAfterDismiss}`);

/* 3c - real marking syntax stops the import; nothing is changed, the line is named */
const MARKED = "BOARD MOI\nStudy ADP 6-22.\n(S//NF) The company departs the assembly area.";
await openCapture(page);
await pasteAndFind(page, MARKED);
await page.waitForTimeout(400);
n = await notice(page);
(n && n.kind === "stop" && n.visible && /GUIDON did not read this text/.test(n.text) && /Line 3/.test(n.text) && /\(S\/\/NF\)/.test(n.text))
  ? ok("(marked text) the import stops, and the notice names line 3 and shows the marking it saw")
  : bad("(marked text) stop notice: " + JSON.stringify(n));
(n && /Line 3: “\(S\/\/NF\) The company/.test(n.text) && !/Line 3: “[^”]*Study ADP/.test(n.text))
  ? ok("(marked text) the quote for line 3 is line 3 - it does not run back into the line above")
  : bad("(marked text) the line-3 quote spills across lines: " + (n && n.text));
(n && n.focusInside && !n.buttons.includes("Continue")) ? ok("(marked text) focus moves onto the notice, and there is no way to continue past it") : bad("(marked text) focus/continue: " + JSON.stringify(n));
(n && /handling and reporting procedures/.test(n.text) && /take that line out and try again/.test(n.text))
  ? ok("(marked text) it says what to do in both cases - really marked, or only study text about markings")
  : bad("(marked text) guidance missing: " + (n && n.text));
const kept = await page.evaluate(() => (document.querySelector("textarea") || {}).value);
kept === MARKED ? ok("(marked text) the pasted text is exactly as typed") : bad("(marked text) the textarea changed: " + JSON.stringify(kept));
!(await page.evaluate(reviewHeading)) ? ok("(marked text) the text was not read - no Review screen") : bad("(marked text) Review rendered anyway");
await page.waitForTimeout(2600);
((await notice(page)) || {}).visible ? ok("(marked text) the notice is still there after a toast would have gone") : bad("(marked text) the notice vanished");
await page.evaluate(() => { const b = [...document.querySelectorAll("[data-moi-guard] button")].find((x) => /Dismiss/.test(x.textContent)); if (b) b.click(); });
await page.waitForTimeout(100);
const afterStopDismiss = await page.evaluate(() => ({ gone: !document.querySelector("[data-moi-guard]"), tag: document.activeElement && document.activeElement.tagName }));
(afterStopDismiss.gone && afterStopDismiss.tag === "TEXTAREA") ? ok("(marked text) Dismiss returns focus to the text box so the line can be taken out") : bad("(marked text) after Dismiss: " + JSON.stringify(afterStopDismiss));

/* 3d - the app's own study text about markings is not marked material */
await openCapture(page);
await pasteAndFind(page, "Is CUI classified information? No. CUI is unclassified information that requires safeguarding (AR 25-2).\nWhat are the three levels of classified information? Top Secret, Secret, and Confidential (AR 380-5).\nA restricted report is confidential (AR 600-52).");
(await onReview(page)) ? ok("(study text about markings) imports normally - the first guard stopped it with an incident-reporting instruction") : bad("(study text about markings) was stopped: " + JSON.stringify(await notice(page)));

/* 3e - a plain board date sails through; a future movement pauses and ASKS */
await openCapture(page);
await pasteAndFind(page, `The board convenes ${TOKENS.FAR.LONG} in the battalion conference room. Topics: land navigation grid coordinates; M4 maximum effective range.\nStudy ADP 6-22 and AR 600-20.`);
(await onReview(page)) ? ok(`(board date, ${TOKENS.FAR.LONG}) a board's own date and room do not pause the import`) : bad("(board date) paused or stopped: " + JSON.stringify(await notice(page)));

const MOVE = `Study ADP 6-22.\nConvoy movement to Fort Example training area on ${TOKENS.SOON.ARMY}, SP time 0600.`;
await openCapture(page);
await pasteAndFind(page, MOVE);
await page.waitForTimeout(400);
n = await notice(page);
(n && n.kind === "check" && /Line 2/.test(n.text) && n.text.includes(TOKENS.SOON.ARMY) && n.focusInside)
  ? ok(`(future movement, ${TOKENS.SOON.ARMY}) the import pauses, names line 2 and quotes the sentence`)
  : bad("(future movement) check notice: " + JSON.stringify(n));
(n && n.buttons.includes("Continue") && n.buttons.includes("Go back and edit")) ? ok("(future movement) the Soldier decides: Continue, or Go back and edit") : bad("(future movement) buttons: " + JSON.stringify(n && n.buttons));
await clickButton(page, /^Go back and edit$/);
await page.waitForTimeout(100);
const backState = await page.evaluate(() => ({ gone: !document.querySelector("[data-moi-guard]"), tag: document.activeElement && document.activeElement.tagName, value: (document.querySelector("textarea") || {}).value }));
(backState.gone && backState.tag === "TEXTAREA" && backState.value === MOVE) ? ok("(future movement) Go back returns to the untouched text with focus in the box") : bad("(future movement) Go back: " + JSON.stringify(backState));
await clickButton(page, /Find my topics/);
await page.waitForTimeout(300);
await clickButton(page, /^Continue$/);
(await onReview(page)) ? ok("(future movement) Continue reads the text as it is and reaches Review") : bad("(future movement) Continue did not reach Review");

/* ======================================================================
   4. SQUAD ROSTER through the real UI
   ====================================================================== */
await page.evaluate(() => { location.hash = "#/leader"; });
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /\+ Add Soldier/.test(b.textContent || "")), null, { timeout: 10000 });
await clickButton(page, /\+ Add Soldier/);
await page.waitForSelector('input[aria-label^="Initials or roster number"]', { timeout: 5000 });
const nameSel = 'input[aria-label="Initials or roster number for entry 1"]';
await page.fill(nameSel, "SPC Doe 270-555-0101");
await page.press(nameSel, "Tab");
await page.waitForTimeout(200);
const rosterState = () => page.evaluate(async (sel) => {
  const input = document.querySelector(sel);
  const msg = document.querySelector('[data-roster-name-msg="0"]');
  const r = await window.G.db.get("kv", "guidon:leader:roster:v1");
  const shownMsg = msg && msg.style.display !== "none" && msg.getBoundingClientRect().height > 0;
  return { value: input && input.value, invalid: input && input.getAttribute("aria-invalid"), describedBy: input && input.getAttribute("aria-describedby"),
    msgId: msg && msg.id, msg: shownMsg ? msg.textContent : "", savedName: r && r.v && r.v[0] ? (r.v[0].name || "") : null };
}, nameSel);
let rs = await rosterState();
(rs.msg && /^Not saved/.test(rs.msg) && /a phone number/.test(rs.msg) && /initials, a callsign, or a roster number/.test(rs.msg))
  ? ok(`(roster) a plain message appears under the field: "${rs.msg}"`)
  : bad("(roster) message: " + JSON.stringify(rs));
!/import|redact|pattern|aggregation/i.test(rs.msg || "") ? ok("(roster) ...with none of MOI Import's wording") : bad("(roster) wrong wording: " + rs.msg);
(rs.value === "SPC Doe 270-555-0101") ? ok("(roster) the typed text stays exactly as typed instead of vanishing") : bad("(roster) field value: " + JSON.stringify(rs.value));
(rs.savedName === "") ? ok("(roster) and it is not saved") : bad("(roster) saved name: " + JSON.stringify(rs.savedName));
(rs.invalid === "true" && rs.describedBy && rs.describedBy === rs.msgId) ? ok("(roster) the field is marked invalid and tied to the message for screen readers") : bad("(roster) aria wiring: " + JSON.stringify(rs));
await page.waitForTimeout(2600);
rs = await rosterState();
rs.msg ? ok("(roster) the message is still there after a toast would have gone") : bad("(roster) the message vanished");
await page.fill(nameSel, "JD");
await page.press(nameSel, "Tab");
await page.waitForTimeout(250);
rs = await rosterState();
(!rs.msg && rs.invalid === null && rs.savedName === "JD") ? ok("(roster) initials clear the message and save") : bad("(roster) after fixing: " + JSON.stringify(rs));
await page.evaluate(async () => { await window.G.db.put("kv", { k: "guidon:leader:roster:v1", v: [] }); });

/* ======================================================================
   5. Phone width
   ====================================================================== */
const phone = await open({ width: 390, height: 844 }, "[390px]");
await openCapture(phone);
await pasteAndFind(phone, "Study ADP 6-22.\n1. (S) The company occupies the position with a long run of words behind it so the excerpt wraps.\nTOP SECRET//SI//NOFORN");
await phone.waitForTimeout(400);
const narrow = await phone.evaluate(() => ({ notice: !!document.querySelector('[data-moi-guard="stop"]'), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }));
(narrow.notice && !narrow.overflow) ? ok("at 390px the notice fits with no sideways scrolling") : bad("390px: " + JSON.stringify(narrow));

noise.length === 0 ? ok("no console errors/warnings or page errors in either context") : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nOPSEC GUARD: all passed" : `\nOPSEC GUARD: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
