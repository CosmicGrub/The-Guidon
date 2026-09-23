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
 *  3. SELF-CHECK - every answer used to destroy the button that held focus
 *     (focus fell to the page body ten times over), told nobody whether the
 *     answer was right, and ended on an unannounced "Score: n / 10". Now an
 *     answer is followed by a feedback panel (right or not, the correct
 *     choice, why, the source from the board card that teaches it) that takes
 *     focus and is announced; "Next question" moves focus to the question;
 *     the score takes focus, is announced, and lists what was missed. The
 *     questions are in plain words.
 *  4. "Open in Train" opens that scenario (it used to land on the ~190-entry
 *     Train catalog with a two-second toast), and the page also reaches the
 *     seed's own OPSEC & Information Security cards.
 *  5. No sideways scrolling at 390px; zero console noise.
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

/* ======================================================================
   3. SELF-CHECK - keyboard focus, feedback, announcements
   ====================================================================== */
const gotoCyber = async (pg) => {
  await pg.evaluate(() => { location.hash = "#/home"; });
  await pg.waitForTimeout(200);
  await pg.evaluate(() => { location.hash = "#/cyber-opsec"; });
  const drawn = await pg.waitForSelector('[data-selfcheck="question"]', { timeout: 10000 }).then(() => true, () => false);
  if (!drawn) throw new Error("the self-check never drew a question element ([data-selfcheck=question]) on #/cyber-opsec");
};
const selfCheckState = (pg) => pg.evaluate(() => {
  const a = document.activeElement;
  const q = document.querySelector('[data-selfcheck="question"]');
  const fb = document.querySelector('[data-selfcheck="feedback"]');
  const sc = document.querySelector('[data-selfcheck="score"]');
  const clean = (n) => n ? n.textContent.replace(/\s+/g, " ").trim() : null;
  return { question: clean(q), feedback: clean(fb), feedbackTone: fb ? fb.className : null, score: clean(sc),
    focus: a === document.body ? "body" : (a === fb ? "feedback" : a === q ? "question" : a === sc ? "score" : (a.tagName + ":" + (a.textContent || "").trim().slice(0, 40))),
    live: (document.getElementById("a11y-live") || {}).textContent || "" };
});
const choiceButtons = (pg) => pg.locator('[role="group"][aria-labelledby="opsec-selfcheck-q"] button');

await gotoCyber(page);
let sc = await selfCheckState(page);
/^Question 1 of 10: /.test(sc.question || "") ? ok(`the self-check opens on "${sc.question.slice(0, 60)}…"`) : bad("first question: " + JSON.stringify(sc));
sc.focus !== "question" ? ok("arriving on the page does not pull focus into the self-check") : bad("route entry stole focus: " + sc.focus);

// Wrong answer, by keyboard: focus the first choice and press Enter.
await choiceButtons(page).nth(0).focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(150);
sc = await selfCheckState(page);
sc.focus === "feedback"
  ? ok("after answering by keyboard, focus is on the feedback (it used to fall to the page body on every answer)")
  : bad("focus after answering: " + sc.focus);
(sc.feedback && /^Not quite\./.test(sc.feedback) && sc.feedback.includes("The answer is: Do not paste it; use authorized handling systems and procedures") && /warn/.test(sc.feedbackTone))
  ? ok("a wrong answer says so and shows the correct choice")
  : bad("wrong-answer feedback: " + JSON.stringify(sc.feedback));
(sc.feedback && sc.feedback.includes("Source: AR 530-1 / AR 25-2 / DoDI 5200.48") && sc.feedback.includes("Do not move or paste it into the personal tool"))
  ? ok("...with the why and the source, taken from the board card that teaches it")
  : bad("feedback lacks the why/source: " + JSON.stringify(sc.feedback));
/Not quite\. The answer is: Do not paste it/.test(sc.live) ? ok("the result is announced through the live region") : bad("live region: " + JSON.stringify(sc.live));
const marked = await choiceButtons(page).allTextContents();
(marked[0].endsWith("— your answer") && marked[1].endsWith("— correct answer")) ? ok("the choices themselves are labelled in words (your answer / correct answer), not by colour alone") : bad("choice labels: " + JSON.stringify(marked));
// A second press on a choice must not re-score.
await page.evaluate(() => { const b = document.querySelectorAll('[role="group"][aria-labelledby="opsec-selfcheck-q"] button')[1]; if (b) b.click(); });
await page.keyboard.press("Tab"); // from the feedback panel to "Next question"
sc = await selfCheckState(page);
/^BUTTON:Next question/.test(sc.focus) ? ok("Tab from the feedback lands on \"Next question\"") : bad("Tab went to: " + sc.focus);
await page.keyboard.press("Enter");
await page.waitForTimeout(150);
sc = await selfCheckState(page);
(sc.focus === "question" && /^Question 2 of 10: /.test(sc.question || "")) ? ok("\"Next question\" moves focus to question 2, not the page body") : bad("after Next: " + JSON.stringify({ focus: sc.focus, q: sc.question }));
!/regex|offline-first|architecture|NIPR/i.test(sc.question || "") ? ok(`question 2 is in plain words: "${sc.question}"`) : bad("engineering wording in: " + sc.question);

// Answer the other nine correctly.
const answers = await page.evaluate(() => window.G.opsec.selfCheck.map((x) => x.answer));
const jargon = await page.evaluate(() => window.G.opsec.selfCheck.map((x) => x.q).filter((q) => /regex|offline-first|architecture|NIPR|DoDIN/i.test(q)));
jargon.length === 0 ? ok("no self-check question uses engineering or network jargon") : bad("jargon in: " + JSON.stringify(jargon));
for (let i = 1; i < answers.length; i++) {
  await choiceButtons(page).nth(answers[i]).click();
  await page.waitForTimeout(80);
  const s = await selfCheckState(page);
  if (!(s.feedback && /^Correct\./.test(s.feedback) && /Source: /.test(s.feedback) && s.focus === "feedback" && /good/.test(s.feedbackTone))) bad(`question ${i + 1} correct-answer feedback: ` + JSON.stringify(s));
  await page.locator("button", { hasText: i === answers.length - 1 ? "See your score" : "Next question" }).click();
  await page.waitForTimeout(80);
}
sc = await selfCheckState(page);
(sc.score === "You got 9 of 10." && sc.focus === "score") ? ok("the score reads \"You got 9 of 10.\" (the repeated press on question 1 was not counted) and takes focus") : bad("score: " + JSON.stringify(sc));
/You got 9 of 10\. 1 to look at again\./.test(sc.live) ? ok("...and is announced") : bad("score live region: " + JSON.stringify(sc.live));
const again = await page.evaluate(() => { const r = document.getElementById("route"); return r ? r.innerText : ""; });
(/Worth another look/.test(again) && /A document is marked CUI\..*Do not paste it/.test(again.replace(/\s+/g, " "))) ? ok("the missed question is listed with its correct answer") : bad("missed list missing");

/* ======================================================================
   4. "Open in Train" opens the scenario; the related category is reachable
   ====================================================================== */
await gotoCyber(page);
await page.locator('button[aria-label="Open Targeted Social Engineering in Train"]').click();
await page.waitForTimeout(1200);
const train = await page.evaluate(() => ({ hash: location.hash, text: (document.getElementById("route") || document.body).innerText.replace(/\s+/g, " ") }));
(train.hash === "#/train" && /friendly-looking message from someone claiming to know your unit/.test(train.text) && !/Unknown Removable Media/.test(train.text))
  ? ok("\"Open in Train\" opens that scenario itself (it used to drop the Soldier on the whole Train catalog with a two-second toast)")
  : bad("Open in Train: " + JSON.stringify({ hash: train.hash, text: train.text.slice(0, 260) }));

await gotoCyber(page);
const relatedBtn = page.locator("button", { hasText: /^Practice OPSEC & information security questions \(\d+\)$/ });
(await relatedBtn.count()) === 1 ? ok("the page also offers the seed's own OPSEC & Information Security cards (five-step process, Critical Information List)") : bad("related-category practice button missing");
await relatedBtn.click();
await page.waitForTimeout(1200);
// Board Drill's category <select> (catSel) was removed in the board-filter
// consolidation - catFilter is a plain closure variable now, with no <select>
// left to scan for. catList's own row for the category shows itself
// selected, driven by that same catFilter - the equivalent, live check.
const drill = await page.evaluate(() => ({
  hash: location.hash,
  cat: [...document.querySelectorAll('.list-detail-list[aria-label="Jump to category"] .list-detail-row.active .ldr-name')].map((n) => n.textContent),
}));
(drill.hash === "#/board" && drill.cat.includes("OPSEC & Information Security")) ? ok("...and opens Board Drill filtered to that category") : bad("related drill: " + JSON.stringify(drill));

/* ======================================================================
   5. Phone width
   ====================================================================== */
const phone = await open({ width: 390, height: 844 }, "[390px]");
await gotoCyber(phone);
await choiceButtons(phone).nth(0).click();
await phone.waitForTimeout(200);
const narrow = await phone.evaluate(() => ({ fb: !!document.querySelector('[data-selfcheck="feedback"]'), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
(narrow.fb && !narrow.overflow) ? ok("at 390px the page with feedback showing has no sideways scrolling") : bad("390px: " + JSON.stringify(narrow));

noise.length === 0 ? ok("no console errors/warnings or page errors") : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nOPSEC CURRICULUM: all passed" : `\nOPSEC CURRICULUM: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
