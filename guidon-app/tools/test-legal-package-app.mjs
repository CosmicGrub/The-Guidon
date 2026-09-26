/**
 * Legal package (GUIDON_COMMAND_LEGAL_PACKAGE.md): the claims about the running
 * app's screens - the first-run statement, what MOI Import does with each kind
 * of finding, what the Squad Roster accepts and saves. Driven through the real
 * built page, the way a Soldier would use it.
 *
 * tools/test-opsec-guard.mjs already proves the check and its two screens on a
 * representative table. The package makes claims that go past that table, so
 * this suite tries them one at a time:
 *
 *   - the words the app uses to tell a user what NOT to enter (paragraph 4,
 *     the roster boundary) and its first-run "unofficial, not endorsed" statement;
 *   - every marking shape the audit matrix lists, and every sample its release
 *     checklist lists, stops MOI Import unread - typed, and uploaded as a file -
 *     leaving the text and the saved plans untouched;
 *   - a labelled UIC is mentioned in a notice that stays; a toll-free number is
 *     not mentioned at all; nothing the app says calls a text cleaned or releasable;
 *   - the saved plan holds only the matched topics, a detected unit line and
 *     detected section headings - and a flagged unit line or heading is left out;
 *   - the roster: which fields it stores, the words that prohibit sensitive
 *     entries, and that an entry the check finds anything in is not saved (each
 *     kind of finding the package names: SSN, labelled DoD ID or UIC, phone,
 *     email, marking);
 *   - LP-061: the roster's "one free-text field". It is NOT the only one: Rank
 *     and MOS are text boxes too and are not checked. That is a finding, pinned
 *     below: it prints "FINDING CONFIRMED" while it is true and FAILS the day it
 *     stops being true, so whoever fixes it must also update the claim.
 *
 * Assertions carry the id of the claim they stand behind ([LP-121] is claim
 * LP-121 in tools/legal-package-claims.json); tools/verify-legal-package.mjs
 * --run reads those lines.
 */
import { bootApp, until, untilAsync, waitForRoute, expectNoConsoleNoise, finish } from "./testkit.mjs";
import { check, tag, list } from "./legal-package-kit.mjs";

const boot = await bootApp({ viewport: { width: 1200, height: 900 } });
const { page, noise } = boot;

/* ---- helpers (state-based waits only) ---- */
const clickButton = (pg, re) => pg.evaluate((src) => {
  const rx = new RegExp(src);
  const b = [...document.querySelectorAll("button")].find((x) => rx.test((x.textContent || "").trim()));
  if (b) { b.click(); return true; }
  return false;
}, re.source);
async function pressButton(pg, re) {
  const there = await until(pg, (src) => [...document.querySelectorAll("button")].some((x) => new RegExp(src).test((x.textContent || "").trim())), re.source);
  return there && (await clickButton(pg, re));
}
async function openCapture(pg) {
  await pg.evaluate(async () => {
    await window.G.db.put("kv", { k: window.G.moiImport.KEY, v: null });
    await window.G.db.put("kv", { k: window.G.moiImport.PLANS_KEY, v: [] });
  });
  await waitForRoute(pg, "#/home");
  await waitForRoute(pg, "#/moi", { fresh: true });
  await pressButton(pg, /Import an MOI/);
  await until(pg, () => !!document.querySelector("textarea"));
}
/** Put text in the capture box. If an earlier step went somewhere else (say a sample the app should have stopped went on to Review), start over on a fresh capture screen so ONE wrong answer is reported as a failed assertion and not as a crash. */
async function paste(pg, text) {
  if (!(await pg.evaluate(() => !!document.querySelector("textarea")))) await openCapture(pg);
  await pg.evaluate((t) => { const ta = document.querySelector("textarea"); ta.value = t; ta.dispatchEvent(new Event("input", { bubbles: true })); }, text);
}
const state = (pg) => pg.evaluate(async () => {
  const n = document.querySelector("[data-moi-guard]");
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  const ta = document.querySelector("textarea");
  return {
    notice: n ? { kind: n.getAttribute("data-moi-guard"), text: n.textContent.replace(/\s+/g, " ").trim(), buttons: [...n.querySelectorAll("button")].map((b) => b.textContent.trim()), visible: n.getBoundingClientRect().height > 0 } : null,
    review: [...document.querySelectorAll("h3")].some((h) => /Review your matches/.test(h.textContent || "")),
    placeholder: /Reading your MOI/.test((document.getElementById("route") || {}).innerText || ""),
    plans: r && r.v ? r.v.length : null,
    box: ta ? ta.value : null,
  };
});
/** Press "Find my topics" and wait for whatever the app decided: a notice, or the Review screen. */
async function findAndSettle(pg) {
  await pressButton(pg, /Find my topics/);
  await until(pg, () => !!document.querySelector("[data-moi-guard]") || [...document.querySelectorAll("h3")].some((h) => /Review your matches/.test(h.textContent || "")));
  return state(pg);
}
const routeText = (pg) => pg.evaluate(() => ((document.getElementById("route") || {}).innerText || "").replace(/\s+/g, " "));
const CLEANED = /\b(?:cleaned|sanitiz\w*|redact\w*|releasable|approved for release|cleared for|declassif\w*|safe to (?:share|release|post)|is safe)\b/i;
const seenTexts = []; // every sentence the app showed about a finding: "never presents one as cleaned or releasable" is judged over all of them

/* ======================================================================
   First-run statement, and what the app tells a user not to enter
   ====================================================================== */
{
  // A real first launch: no acknowledgement stored, and a browser that does not say it is automated
  // (05-opsec-guard.js skips its statement under webdriver so it cannot steal clicks from other suites).
  const first = await boot.openSession({ profile: null, noise, beforeLoad: async ({ page: p }) => { await p.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); }); } });
  const shown = await until(first.page, () => !!document.querySelector(".gm-box"));
  const text = shown ? await first.page.evaluate(() => document.querySelector(".gm-box").textContent.replace(/\s+/g, " ").trim()) : "";
  const disclaimer = await first.page.evaluate(() => window.G.opsecGuard.DISCLAIMER);
  check(shown && /^Before you start/.test(text) && text.includes("GUIDON is an unofficial, independent study aid and is not endorsed by the Department of Defense, the U.S. Army, or any government agency.") && text.includes(disclaimer.slice(0, 120)),
    tag("LP-094", "LP-139", "LP-008") + " on a first launch the app opens a 'Before you start' statement: GUIDON is an unofficial, independent study aid and is not endorsed by the Department of Defense, the U.S. Army, or any government agency",
    () => "modal shown: " + shown + " | " + text.slice(0, 200));
  check(shown && ["Do not enter classified information", "Controlled Unclassified Information (CUI)", "real operational orders or rosters", "sensitive personal data", "information your organization has not authorized for storage on this device"].every((s) => text.includes(s)),
    tag("LP-023") + " the same first-run statement tells the user not to enter classified information, CUI, real operational orders or rosters, sensitive personal data, or information not authorized for storage on the device",
    () => "statement: " + text.slice(0, 400));
  const pressed = await pressButton(first.page, /^I understand$/);
  const acked = pressed && (await until(first.page, () => { try { return localStorage.getItem("guidon:opsec-ack:v1") === "accepted"; } catch (e) { return false; } }));
  check(acked, tag("LP-094") + " pressing 'I understand' is remembered on the device, so it is a first-run statement and not a nag", "the acknowledgement was not stored");
  await first.context.close();
}
{
  await openCapture(page);
  const moiCopy = await routeText(page);
  await waitForRoute(page, "#/leader", { ready: "button" });
  const rosterCopy = await routeText(page);
  const need = [
    ["classified information", moiCopy], ["CUI", moiCopy], ["real operational orders/rosters", moiCopy], ["mission grids", moiCopy], ["sensitive personnel data", moiCopy],
    ["Do not enter CUI, classified information, UICs, DoD IDs, SSNs, phone numbers, email/address data", rosterCopy],
  ];
  const missing = need.filter(([s, where]) => !where.includes(s)).map(([s]) => s);
  check(missing.length === 0, tag("LP-023") + " the MOI Import screen tells the user not to paste or upload classified information, CUI, real operational orders/rosters, mission grids or sensitive personnel data, and the Squad Roster screen tells them not to enter CUI, classified information, UICs, DoD IDs, SSNs, phone numbers or email/address data", () => "missing from the screens: " + list(missing));
  check(/Use initials, a callsign, or a roster number — not full legal names\./.test(rosterCopy) && /Keep it to dates\./.test(rosterCopy),
    tag("LP-059", "LP-132") + " the Squad Roster screen asks for initials, a callsign, or a roster number, 'not full legal names', and to 'keep it to dates'", () => rosterCopy.slice(0, 500));
  check(/medical, legal, SHARP, financial, or performance narrative/.test(rosterCopy) && /SSNs/.test(rosterCopy) && /DoD IDs/.test(rosterCopy) && /Those belong only in authorized systems and processes/.test(rosterCopy),
    tag("LP-060") + " and expressly prohibits sensitive identifiers (UICs, DoD IDs, SSNs, phone numbers, email/address data) and narrative personnel information (medical, legal, SHARP, financial or performance narrative): 'those belong only in authorized systems and processes'",
    () => rosterCopy.slice(0, 500));
}

/* ======================================================================
   MOI Import: marking syntax stops it, in every form the package lists
   ====================================================================== */
const STUDY_LINE = "Study ADP 6-22 before the board.";
const STOP_SAMPLES = [
  ["a SECRET banner line", `BOARD MOI\n${STUDY_LINE}\nSECRET\nThe next line follows.`, 3],
  ["a TOP SECRET banner line", `BOARD MOI\nTOP SECRET\n${STUDY_LINE}`, 2],
  ["a CONFIDENTIAL banner line", `CONFIDENTIAL\n${STUDY_LINE}`, 1],
  ["a CUI banner line", `CUI\nUnit training schedule\n${STUDY_LINE}\nCUI`, 1],
  ["a FOUO banner line", `${STUDY_LINE}\nFOUO`, 2],
  ["a FOR OFFICIAL USE ONLY banner line", `FOR OFFICIAL USE ONLY\nRoster\n${STUDY_LINE}`, 1],
  ["SECRET//NOFORN", `${STUDY_LINE}\nSECRET//NOFORN`, 2],
  ["a CUI//SP-PRVCY control string", `${STUDY_LINE}\nHeader reads CUI//SP-PRVCY on every page.`, 2],
  ["UNCLASSIFIED//FOUO", `${STUDY_LINE}\nUNCLASSIFIED//FOUO`, 2],
  ["a (S//NF) portion mark", `${STUDY_LINE}\n(S//NF) The company departs the assembly area.`, 2],
  ["a (CUI) portion mark at the start of a portion", `${STUDY_LINE}\n(CUI) The roster is attached.`, 2],
  ["a CUI Category: line", `Controlled by: G-1\nCUI Category: PRVCY\n${STUDY_LINE}`, 2],
  ["a CLASSIFICATION: label", `${STUDY_LINE}\nCLASSIFICATION: SECRET`, 2],
  ["a page whose header and footer banners were read as one line", "SECRET HEADQUARTERS 1ST BATTALION 5TH INFANTRY OPERATION ORDER 26-01 Task organization follows on this page SECRET", 1],
];
await openCapture(page);
{
  const failures = [];
  for (const [name, text, line] of STOP_SAMPLES) {
    await paste(page, text);
    const s = await findAndSettle(page);
    seenTexts.push(s.notice ? s.notice.text : "");
    const ok = s.notice && s.notice.kind === "stop" && s.notice.visible && /GUIDON did not read this text/.test(s.notice.text) && new RegExp("Line " + line + ":").test(s.notice.text)
      && !s.notice.buttons.includes("Continue") && !s.review && !s.placeholder && s.plans === 0 && s.box === text;
    if (!ok) failures.push(name + " -> " + JSON.stringify(s).slice(0, 220));
  }
  check(failures.length === 0,
    tag("LP-029", "LP-121", "LP-171", "LP-024", "LP-180") + " every marking shape the audit matrix and release checklist list stops the import unread - " + STOP_SAMPLES.length + " samples (banner lines for all six words, control strings, portion marks, CUI Category, CLASSIFICATION label, a page banner): each shows 'GUIDON did not read this text' naming the right line, offers no Continue, never reaches matching (no Review, no 'Reading your MOI'), saves nothing, and leaves the pasted text exactly as typed",
    () => failures.join(" || "));
}
{
  const input = 'input[type="file"][aria-label^="Upload MOI file"]';
  await paste(page, "");
  await page.setInputFiles(input, { name: "moi.txt", mimeType: "text/plain", buffer: Buffer.from(`BOARD MOI\n${STUDY_LINE}\n(S//NF) The company departs the assembly area.\n`) });
  await until(page, () => /Read moi\.txt/.test(document.body.innerText));
  const s = await findAndSettle(page);
  check(s.notice && s.notice.kind === "stop" && /Line 3:/.test(s.notice.text) && !s.review && s.plans === 0 && s.box === "",
    tag("LP-026", "LP-171") + " text that arrives as an uploaded file goes through the same check as pasted text: a .txt file with a (S//NF) portion mark stops the import, names line 3, saves nothing, and the text box is untouched",
    () => JSON.stringify(s).slice(0, 300));
  await page.setInputFiles(input, { name: "moi2.txt", mimeType: "text/plain", buffer: Buffer.from("AR 600-20 2020\nAR 600-25 2019\nADP 6-22\n") });
  await until(page, () => /Read moi2\.txt/.test(document.body.innerText));
  const s2 = await findAndSettle(page);
  const summary = await page.evaluate(() => { const h3 = [...document.querySelectorAll("h3")].find((h) => /Review your matches/.test(h.textContent || "")); return h3 && h3.nextElementSibling ? h3.nextElementSibling.textContent : null; });
  check(s2.review && !s2.notice && /^3 matched/.test(summary || ""),
    tag("LP-026") + " an uploaded file of citations with their years ('AR 600-20 2020') reaches Review with every publication intact - the file's text is read as it is, not rewritten",
    () => "review " + s2.review + ", summary " + summary);
}

/* ---- study text about markings imports normally ---- */
{
  await openCapture(page);
  await paste(page, `Is CUI classified information? No. CUI is unclassified information that requires safeguarding (AR 25-2).\nWhat are the three levels of classified information? Top Secret, Secret, and Confidential (AR 380-5).\n${STUDY_LINE}`);
  const s = await findAndSettle(page);
  seenTexts.push(await routeText(page));
  check(s.review && !s.notice,
    tag("LP-172", "LP-037") + " study text about markings ('CUI is unclassified information...'; 'Top Secret, Secret, and Confidential') imports normally: straight to Review, no notice",
    () => JSON.stringify(s).slice(0, 300));
}

/* ======================================================================
   Routine contact details: a UIC is mentioned; a toll-free line is not
   ====================================================================== */
{
  await openCapture(page);
  await paste(page, `LEADERSHIP:\n${STUDY_LINE}\nUnit UIC W1ABCD is the assigned unit.`);
  const s = await findAndSettle(page);
  seenTexts.push(s.notice ? s.notice.text : "");
  const stays = !!s.notice && s.notice.kind === "note" && /a unit identification code/.test(s.notice.text) && !/W1ABCD/.test(s.notice.text);
  const stillThere = stays && (await until(page, () => { const n = document.querySelector("[data-moi-guard]"); return !!n && n.getBoundingClientRect().height > 0; }));
  const dismissed = stays && (await clickButton(page, /^Dismiss$/)) && (await until(page, () => !document.querySelector("[data-moi-guard]")));
  check(s.review && stays && stillThere && dismissed,
    tag("LP-047") + " a six-character code after a UIC label is mentioned in a notice that names what was seen (a unit identification code) without repeating it, stays on screen, and goes only when the user dismisses it",
    () => JSON.stringify(s).slice(0, 300));
  await openCapture(page);
  await paste(page, `DoD Safe Helpline: 877-995-5247.\n${STUDY_LINE}`);
  const t = await findAndSettle(page);
  check(t.review && !t.notice, tag("LP-047") + " a published toll-free line is not a person's number: the import goes straight to Review with no notice", () => JSON.stringify(t).slice(0, 300));
}

/* ---- something that warrants a look: paused, then the Soldier decides ---- */
{
  await openCapture(page);
  const typed = `SSN 123-45-6789\n${STUDY_LINE}`;
  await paste(page, typed);
  const s = await findAndSettle(page);
  seenTexts.push(s.notice ? s.notice.text : "");
  check(!!s.notice && s.notice.kind === "check" && s.notice.buttons.includes("Continue") && s.notice.buttons.includes("Go back and edit") && /a Social Security number/.test(s.notice.text) && !/123-45-6789/.test(s.notice.text) && s.box === typed && !s.review,
    tag("LP-044", "LP-173") + " a Social Security number pauses the import and shows the line (the number masked, never repeated in full); the Soldier chooses Continue or Go back and edit, and the text is untouched",
    () => JSON.stringify(s).slice(0, 300));
}
{
  const all = seenTexts.join(" | ");
  check(all.length > 300 && !CLEANED.test(all),
    tag("LP-125") + " nothing the app said about any of these texts - the stop notices, the pause, the notes, the Review screen, the roster messages below - calls one cleaned, sanitized, redacted, releasable or safe (" + seenTexts.length + " screens read so far)",
    () => "found: " + (CLEANED.exec(all) || [""])[0] + " near: " + all.slice(Math.max(0, all.search(CLEANED) - 60), all.search(CLEANED) + 60));
}

/* ======================================================================
   The saved plan: only topics, a unit line, section headings
   ====================================================================== */
const SENTINEL = "ZQX-SENTINEL-NEVER-SAVED";
async function buildPlan(text) {
  await openCapture(page);
  await paste(page, text);
  const s = await findAndSettle(page);
  if (s.notice && s.notice.kind === "check") await pressButton(page, /^Continue$/);
  await until(page, () => [...document.querySelectorAll("h3")].some((h) => /Review your matches/.test(h.textContent || "")));
  await pressButton(page, /^Build/);
  await untilAsync(page, async () => { const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY); return !!(r && r.v && r.v.length); });
  return page.evaluate(async () => { const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY); const f = (r && r.v) || []; return f.length ? f[f.length - 1].current : null; });
}
{
  const plan = await buildPlan(`3rd Battalion 15th Infantry\nLEADERSHIP:\n${STUDY_LINE}\n${SENTINEL} is a line of the MOI that must never be saved.\nCOUNSELING:\nRead AR 623-3.`);
  const json = JSON.stringify(plan);
  const headings = ((plan && plan.groups) || []).map((g) => g.heading);
  const strings = plan ? Object.keys(plan).filter((k) => typeof plan[k] === "string" && plan[k] !== "").sort() : [];
  check(!!plan && plan.name === "3rd Battalion 15th Infantry" && headings.includes("LEADERSHIP") && headings.includes("COUNSELING") && plan.topics.length >= 2 && !json.includes(SENTINEL) && !/is a line of the MOI/.test(json),
    tag("LP-049") + " the saved plan holds the matched topics, the detected unit line (\"3rd Battalion 15th Infantry\") and the detected section headings (LEADERSHIP, COUNSELING) - and not the rest of the MOI's sentences",
    () => "plan: " + json.slice(0, 500));
  check(!!plan && strings.join() === "name" && Object.keys(plan).every((k) => ["name", "importedAt", "dueDate", "topics", "topicCoverage", "topicLinks", "topicTiers", "groups", "generatedDrillCategories"].includes(k)),
    tag("LP-049") + " apart from topic names and headings, the plan's only text taken from the MOI is the one unit line: its only non-empty string field is " + strings.join(", "),
    () => "keys: " + (plan ? Object.keys(plan).join(",") + " strings: " + strings.join(",") : "no plan"));
}
{
  const plan = await buildPlan(`3rd Battalion 15th Infantry POC 270-555-0101\nSSG DOE 270-555-0101:\n${STUDY_LINE}\nLEADERSHIP:\nRead AR 623-3.`);
  const json = JSON.stringify(plan);
  check(!!plan && !/270-555-0101|SSG DOE|POC/.test(json) && /^MOI imported /.test(plan.name) && (plan.groups || []).every((g) => g.heading !== "SSG DOE 270-555-0101") && /General/.test(json),
    tag("LP-050", "LP-174") + " a unit line and a heading the check found something in are left out of the saved plan rather than rewritten: the flagged unit line is replaced by a plain 'MOI imported <date>' name, the flagged heading's topics fall under 'General', and no fragment of either (no phone number, no 'SSG DOE') is stored",
    () => "plan: " + json.slice(0, 500));
}

/* ======================================================================
   Squad Roster
   ====================================================================== */
await waitForRoute(page, "#/leader", { ready: "button" });
await pressButton(page, /\+ Add Soldier/);
await until(page, () => !!document.querySelector('input[aria-label^="Initials or roster number"]'));
const NAME = 'input[aria-label="Initials or roster number for entry 1"]';
const RANK = 'input[aria-label="Rank for roster entry 1"]';
const MOS = 'input[aria-label="MOS for roster entry 1"]';
const ROSTER_KEY = "guidon:leader:roster:v1";
const rosterRow = () => page.evaluate(async (k) => { const r = await window.G.db.get("kv", k); return r && r.v && r.v[0] ? r.v[0] : null; }, ROSTER_KEY);
const rosterMsg = () => page.evaluate((sel) => {
  const input = document.querySelector(sel), msg = document.querySelector('[data-roster-name-msg="0"]');
  return { value: input && input.value, invalid: input && input.getAttribute("aria-invalid"), described: input && input.getAttribute("aria-describedby"), msgId: msg && msg.id, shown: !!msg && msg.style.display !== "none" && msg.getBoundingClientRect().height > 0, msg: msg ? msg.textContent : "" };
}, NAME);
const fill = async (sel, text) => { await page.fill(sel, text); await page.press(sel, "Tab"); };
{
  await fill(RANK, "SPC"); await fill(MOS, "92A"); await fill(NAME, "JD");
  for (const label of ["Last counselling", "Last AFT", "Last weapons qual", "Last NCOER thru-date"]) await fill(`input[aria-label="${label} for roster entry 1"]`, "2026-01-15");
  await untilAsync(page, async (k) => { const r = await window.G.db.get("kv", k); const e = r && r.v && r.v[0]; return !!(e && e.name === "JD" && e.rank === "SPC" && e.mos === "92A" && e.ncoer); }, ROSTER_KEY);
  const saved = await rosterRow();
  const fields = await page.evaluate(() => {
    const card = document.querySelector('[data-roster-idx="0"]');
    return { types: [...card.querySelectorAll("input, textarea, select")].map((c) => c.tagName + ":" + (c.type || "")), textareas: card.querySelectorAll("textarea").length };
  });
  const ALLOWED = ["aft", "counseled", "mos", "name", "ncoer", "rank", "wpn", "moiBriefed"];
  const keys = saved ? Object.keys(saved).sort() : [];
  check(!!saved && keys.every((k) => ALLOWED.includes(k)) && ["aft", "counseled", "mos", "name", "ncoer", "rank", "wpn"].every((k) => keys.includes(k)) && fields.textareas === 0 && fields.types.filter((t) => /:date$/.test(t)).length === 4,
    tag("LP-058", "LP-131") + " the roster stores an entry as a rank, an MOS, initials and four readiness dates (counselling, AFT, weapons qualification, NCOER thru-date) - no narrative box, no other field: " + keys.join(", "),
    () => "saved: " + JSON.stringify(saved) + "; controls: " + JSON.stringify(fields));
}
{
  // Every kind of finding the package names is refused in the initials box: not saved, text left as typed, a plain message that stays under the field.
  const KINDS = [["an SSN", "SSN 123-45-6789", /a Social Security number/], ["a labelled DoD ID", "DoD ID 1234567890", /a DoD ID number/], ["a labelled UIC", "UIC W1ABCD", /a unit identification code/],
    ["a phone number", "SPC Doe 270-555-0101", /a phone number/], ["an email address", "jane.doe@army.mil", /an email address/], ["a classification marking", "SECRET//NOFORN", /a classification or handling marking/]];
  const problems = [];
  for (const [name, typed, want] of KINDS) {
    await fill(NAME, "JD");
    await until(page, () => { const m = document.querySelector('[data-roster-name-msg="0"]'); return !m || m.style.display === "none"; });
    await fill(NAME, typed);
    await until(page, () => { const m = document.querySelector('[data-roster-name-msg="0"]'); return !!m && m.style.display !== "none" && m.textContent.length > 0; });
    const m = await rosterMsg();
    const row = await rosterRow();
    seenTexts.push(m.msg);
    const good = m.shown && want.test(m.msg) && /^Not saved/.test(m.msg) && /initials, a callsign, or a roster number/.test(m.msg) && m.value === typed && m.invalid === "true" && m.described === m.msgId && !!row && row.name === "JD";
    if (!good) problems.push(name + " -> " + JSON.stringify(m) + " saved=" + (row && row.name));
  }
  check(problems.length === 0,
    tag("LP-062", "LP-133", "LP-175", "LP-182") + " an entry in the initials box that the check finds anything in is not saved (the earlier initials stay) and stays exactly as typed, and a plain explanation ('Not saved - that looks like ...') stays beneath the field, tied to it for screen readers - for each kind the package names: an SSN, a labelled DoD ID, a labelled UIC, a phone number, an email address, a classification marking",
    () => problems.join(" || "));
  await fill(NAME, "SGT");
  await untilAsync(page, async (k) => { const r = await window.G.db.get("kv", k); const e = r && r.v && r.v[0]; return !!(e && e.name === "SGT"); }, ROSTER_KEY);
  const cleared = await until(page, () => { const m = document.querySelector('[data-roster-name-msg="0"]'); return !m || m.style.display === "none"; });
  check(cleared, tag("LP-062") + " correcting the entry to plain initials clears the message and saves", "the message did not clear");
}
{
  // LP-061 - the package says the roster's ONE free-text field is the initials box. Rank and MOS are text boxes too, and nothing checks them.
  const texts = await page.evaluate(() => [...document.querySelector('[data-roster-idx="0"]').querySelectorAll("input")].filter((i) => i.type === "text").map((i) => i.getAttribute("aria-label")));
  await fill(RANK, "123-45-6789");
  await untilAsync(page, async (k) => { const r = await window.G.db.get("kv", k); const e = r && r.v && r.v[0]; return !!(e && /123-45-6789/.test(e.rank || "")); }, ROSTER_KEY);
  const row = await rosterRow();
  const stillUnscreened = texts.length > 1 && !!row && row.rank === "123-45-6789";
  check(stillUnscreened,
    tag("LP-061") + " FINDING CONFIRMED: the roster card has " + texts.length + " free-text boxes (" + texts.join("; ") + "), not one; typing a Social Security number into Rank is saved as typed (\"" + (row && row.rank) + "\") because only the initials box is checked",
    () => "the finding no longer reproduces (text boxes: " + texts.length + ", rank saved: " + JSON.stringify(row && row.rank) + ") - the app or the package changed: update claim LP-061 in tools/legal-package-claims.json");
  await fill(RANK, "SPC");
}

expectNoConsoleNoise(noise);
await finish("LEGAL PACKAGE APP");
