/**
 * Cross-screen predicate consistency, part 2.
 *
 * tools/test-consistency.mjs checks whether the CORPUS contradicts itself
 * (a board card teaching a superseded standard). This file checks a
 * different failure mode with the same shape: whether the APP contradicts
 * itself — the same underlying fact, computed independently on two or more
 * screens, disagreeing about what it is. That bug has shipped for real more
 * than once here (see the "shared predicate" comments throughout
 * src/index.html next to G.board.isDueSrs / isMasteredSrs / util.etsUrgency /
 * util.boardUrgency / G.streak / the IDP "/done/i" match), which is exactly
 * why those shared predicates now exist. This suite seeds one deterministic
 * fact via G.db/G.store, then visits every screen that displays something
 * derived from it and asserts they all agree — with each other, and with the
 * value hand-computed from the seed.
 *
 * Five independent checks, chosen by reading src/index.html for real
 * multi-site call sites (not invented):
 *   1. Board-question "due count"      — Home / Board Drill / Board
 *      Readiness / Progress, all via G.board.isDueSrs.
 *   2. Board-question "mastered count" — Board Readiness / Progress, both
 *      via G.board.isMasteredSrs.
 *   3. ETS urgency (days + colour)     — Home / Transition / Calendar, via
 *      util.etsUrgency.
 *   4. Board-date urgency (days + colour) — Home / Calendar, via
 *      util.boardUrgency (two independently-written call sites, not the
 *      same function object — Calendar re-derives the day count itself).
 *   5. Daily streak (current + best)   — Home / Progress, both via
 *      G.streak / store.streakDays().
 *   6. IDP goal "Done" count           — Home's readiness tile / My IDP's
 *      own dashboard, both via the /done/i status match.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

/** YYYY-MM-DD for "n days from today", computed the same way test-calendar.mjs
    does — local date arithmetic in Node, matching how a Soldier would enter
    a date, and how the app's own `new Date(str + "T00:00:00")` parses it. */
function daysFromNowStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);
// Onboarding lands on #/home by default, so a later `location.hash =
// "#/home"` after seeding would be a same-hash no-op — no hashchange, no
// re-render, and Home would show its stale pre-seed state. Step off it now
// so the real navigation below actually fires the router.
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(300);

// ── Pick two real board categories to seed against, dynamically — not
//    hardcoded names, since the exact corpus can shift release to release
//    (test-consistency.mjs pins the corpus COUNTS; this only needs two
//    categories big enough to hold our seed). ──────────────────────────────
const catMeta = await page.evaluate(() => {
  const qs = (window.G.store && window.G.store.boardQuestions && window.G.store.boardQuestions()) || [];
  const byCat = {};
  qs.forEach((q) => { (byCat[q.category] = byCat[q.category] || []).push(q.id); });
  let cats = Object.keys(byCat).filter((c) => byCat[c].length >= 8);
  if (cats.length < 2) cats = Object.keys(byCat).filter((c) => byCat[c].length >= 5);
  cats.sort((a, b) => byCat[b].length - byCat[a].length);
  return {
    total: qs.length,
    catA: cats[0], catB: cats[1],
    idsA: cats[0] ? byCat[cats[0]] : [],
    idsB: cats[1] ? byCat[cats[1]] : [],
  };
});
if (!catMeta.catA || !catMeta.catB) {
  bad("could not find two board-question categories large enough to seed — aborting");
  await browser.close(); server.close(); process.exit(1);
}
const dueIds = catMeta.idsA.slice(0, 5);       // 5 "due" cards in category A
const masteredIds = catMeta.idsB.slice(0, 4);  // 4 "mastered" cards in category B
const catATotal = catMeta.idsA.length;
const catBTotal = catMeta.idsB.length;
ok(`seeding against real categories "${catMeta.catA}" (${catATotal} Qs) and "${catMeta.catB}" (${catBTotal} Qs), ${catMeta.total} Qs total`);

// ── ETS / board date: 45 and 10 days out, landing deliberately in the amber
//    band on both scales (etsUrgency: <=30 red / <=90 amber / else green;
//    boardUrgency: <=3 red / <=14 amber / else green) so a screen that used
//    the wrong thresholds — not just the wrong date — would also be caught. ─
const etsDateStr = daysFromNowStr(45);
const boardDateStr = daysFromNowStr(10);

// ── Seed everything before visiting any screen that reads it. ─────────────
await page.evaluate(async ({ dueIds, masteredIds, etsDateStr, boardDateStr }) => {
  const now = Date.now();
  const DAY = 86400000;
  // Real srs: row shape, matching schedule()'s own fields in src/index.html.
  for (const id of dueIds) {
    await window.G.db.setSetting("srs:" + id, { reps: 3, ease: 2.3, interval: 3, due: now - 2 * DAY, misses: 0, lastGrade: 1 });
  }
  for (const id of masteredIds) {
    await window.G.db.setSetting("srs:" + id, { reps: 2, ease: 2.5, interval: 30, due: now + 30 * DAY, misses: 0, lastGrade: 2 });
  }
  // ETS/board date via the real store.setSetting() — not a raw kv write —
  // so the same bidirectional settings<->profile sync a real Soldier's
  // Settings/onboarding save triggers also runs here.
  await window.G.store.setSetting("etsDate", etsDateStr);
  await window.G.store.setSetting("boardDate", boardDateStr);
  // Streak: lastActive already "today" (by the app's own G.streak today(),
  // which uses LOCAL date parts — getFullYear/getMonth/getDate — not
  // toISOString(), specifically so day-rollover lands on the Soldier's own
  // local midnight rather than a fixed UTC instant hours away from it; see
  // that function's own comment in src/index.html) so Home's
  // G.streak.tick() is a same-day no-op and every screen reads the
  // identical seeded count regardless of visit order. Was seeded with the
  // UTC date instead (a stale mismatch with the app's own local-date
  // logic) — harmless most of the day, but false-failed this exact
  // assertion for hours around every UTC midnight in any timezone behind
  // UTC (i.e. most of the Western Hemisphere's evening), where local date
  // still reads "yesterday" relative to UTC's date.
  const d = new Date();
  const today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  await window.G.db.setSetting("streak:v1", { lastActive: today, count: 4, longestCount: 6 });
  // IDP goals — real row shape (goal/status/domain/competency/target).
  await window.G.db.setSetting("idp:goals", [
    { goal: "Complete BLC", status: "Done", domain: "Leads", competency: "", target: "" },
    { goal: "Mentor two junior NCOs", status: "Done", domain: "Develops", competency: "", target: "" },
    { goal: "Finish resilience training module", status: "In progress", domain: "Leads", competency: "", target: "" },
    { goal: "Read FM 6-22 cover to cover", status: "Not started", domain: "Extends Influence", competency: "", target: "" },
    { goal: "Complete a civilian credential", status: "Not started", domain: "", competency: "", target: "" },
  ]);
}, { dueIds, masteredIds, etsDateStr, boardDateStr });

// ── Colour-band reference: resolve --red/--amber/--green the same way the
//    browser resolves them wherever they're actually applied, so comparing
//    an element's computed colour to these strings is meaningful regardless
//    of whether that screen set the var() on a text colour or a border. ────
const colorRefs = await page.evaluate(() => {
  function probe(name) {
    const p = document.createElement("div");
    p.style.color = "var(--" + name + ")";
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }
  return { red: probe("red"), amber: probe("amber"), green: probe("green") };
});
function band(color) {
  if (color === colorRefs.red) return "red";
  if (color === colorRefs.amber) return "amber";
  if (color === colorRefs.green) return "green";
  return "unknown(" + color + ")";
}

// ═══════════════════════════════════════════════════════════════════════
// HOME — gather every derived value this one screen shows in one visit.
// ═══════════════════════════════════════════════════════════════════════
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(1000);

const home = await page.evaluate((refsUnused) => {
  const out = {};
  // 1) due-count card
  const dueCard = [...document.querySelectorAll("[aria-label]")].find((e) => /board questions due for review/i.test(e.getAttribute("aria-label") || ""));
  out.dueCount = dueCard ? parseInt((dueCard.getAttribute("aria-label").match(/^(\d+)/) || [])[1], 10) : null;
  // 3) ETS banner
  const etsDaysEl = document.querySelector(".ets-days");
  out.etsDays = etsDaysEl ? parseInt(etsDaysEl.textContent.trim(), 10) : null;
  out.etsColor = etsDaysEl ? getComputedStyle(etsDaysEl).color : null;
  // 4) board-date countdown banner
  const bdDaysEl = document.querySelector(".tx-countdown-days");
  out.boardDays = bdDaysEl ? parseInt(bdDaysEl.textContent.trim(), 10) : null;
  out.boardColor = bdDaysEl ? getComputedStyle(bdDaysEl).color : null;
  // 5) streak banner
  const streakCountEl = document.querySelector(".streak-count");
  out.streakCount = streakCountEl ? parseInt((streakCountEl.textContent.match(/^(\d+)/) || [])[1], 10) : null;
  const streakBestEl = document.querySelector(".streak-best");
  out.streakBest = streakBestEl ? parseInt((streakBestEl.textContent.match(/(\d+)/) || [])[1], 10) : null;
  // 6) IDP readiness tile
  const idpTile = [...document.querySelectorAll("[aria-label]")].find((e) => /^IDP goals:/.test(e.getAttribute("aria-label") || ""));
  const m = idpTile ? idpTile.getAttribute("aria-label").match(/^IDP goals: (\d+)\/(\d+)\./) : null;
  out.idpDone = m ? parseInt(m[1], 10) : null;
  out.idpTotal = m ? parseInt(m[2], 10) : null;
  return out;
}, null);

home.dueCount === 5 ? ok(`Home due-count card reads 5 (${JSON.stringify(home.dueCount)})`) : bad("Home due-count card: expected 5, got " + home.dueCount);
home.etsDays === 45 ? ok("Home ETS banner reads 45 days out") : bad("Home ETS days: expected 45, got " + home.etsDays);
band(home.etsColor) === "amber" ? ok("Home ETS banner colour is amber") : bad("Home ETS colour band: " + band(home.etsColor));
home.boardDays === 10 ? ok("Home board-date countdown reads 10 days out") : bad("Home board-date days: expected 10, got " + home.boardDays);
band(home.boardColor) === "amber" ? ok("Home board-date countdown colour is amber") : bad("Home board-date colour band: " + band(home.boardColor));
home.streakCount === 4 ? ok("Home streak banner reads 4-day streak") : bad("Home streak count: expected 4, got " + home.streakCount);
home.streakBest === 6 ? ok("Home streak banner shows best 6") : bad("Home streak best: expected 6, got " + home.streakBest);
home.idpDone === 2 && home.idpTotal === 5 ? ok("Home readiness tile reads IDP goals 2/5") : bad("Home IDP tile: expected 2/5, got " + home.idpDone + "/" + home.idpTotal);

// ═══════════════════════════════════════════════════════════════════════
// BOARD PREP — Board Drill's due chip, then the Readiness tab's stats.
// ═══════════════════════════════════════════════════════════════════════
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1200);

const dueChipText = (await page.locator(".due-chip:not(.leech-chip):not(.star-chip)").first().textContent().catch(() => "")) || "";
const dueChipCount = (dueChipText.match(/(\d+)\s+due/) || [])[1];
dueChipCount !== undefined && parseInt(dueChipCount, 10) === 5
  ? ok(`Board Drill's due chip reads "${dueChipText.trim()}" (5 due)`)
  : bad(`Board Drill's due chip: expected 5 due, got "${dueChipText.trim()}"`);

await page.locator("button", { hasText: /^Readiness$/ }).click();
await page.waitForTimeout(1000);

const readiness = await page.evaluate(() => {
  function statValue(labelSubstr) {
    for (const s of document.querySelectorAll(".stat")) {
      const k = s.querySelector(".k"), v = s.querySelector(".v");
      if (k && v && k.textContent.includes(labelSubstr)) return v.textContent.trim();
    }
    return null;
  }
  return { dueNow: statValue("Due for review now"), mastered: statValue("Questions mastered") };
});
const readinessDue = readiness.dueNow ? parseInt(readiness.dueNow, 10) : (readiness.dueNow === "None — you're current" ? 0 : NaN);
readinessDue === 5 ? ok(`Board Readiness "Due for review now" reads "${readiness.dueNow}" (5)`) : bad(`Board Readiness due: expected 5, got "${readiness.dueNow}"`);
const readinessMasteredMatch = readiness.mastered && readiness.mastered.match(/^(\d+)\s*\/\s*(\d+)$/);
readinessMasteredMatch && parseInt(readinessMasteredMatch[1], 10) === 4
  ? ok(`Board Readiness "Questions mastered" reads "${readiness.mastered}" (4 mastered)`)
  : bad(`Board Readiness mastered: expected 4/<total>, got "${readiness.mastered}"`);

// ═══════════════════════════════════════════════════════════════════════
// PROGRESS — the due badge, category A's due row, category B's mastered
// row, and the Weekly Study Goal widget's own streak stat.
// ═══════════════════════════════════════════════════════════════════════
await page.evaluate(() => { location.hash = "#/progress"; });
await page.waitForTimeout(1200);

// Progress's per-category "Board Q Readiness" rows (and the standalone due
// badge) were collapsed into two one-stat teasers by the intuitivism pass
// (Board Drill Mastery / Board Q Readiness, each a single .panel with an
// .eyebrow + h3 + p.hint). The teasers still expose the same raw numbers in
// their hint text - masteredCount and totalDue - specifically so this
// suite's real cross-view-consistency check survives the UI shrink instead
// of losing coverage to it.
const progress = await page.evaluate(() => {
  const out = {};
  function panelByEyebrow(label) {
    for (const p of document.querySelectorAll(".panel")) {
      const eyebrow = p.querySelector(".eyebrow");
      if (eyebrow && eyebrow.textContent.trim() === label) return p;
    }
    return null;
  }
  const bqPanel = panelByEyebrow("Board Q Readiness");
  const bqHint = bqPanel ? bqPanel.querySelector("p.hint") : null;
  out.bqHint = bqHint ? bqHint.textContent.trim() : null;
  // streak, via the Weekly Study Goal widget
  for (const s of document.querySelectorAll(".stat")) {
    const k = s.querySelector(".k"), v = s.querySelector(".v");
    if (k && v && k.textContent.includes("Study streak")) { out.streakStat = v.textContent.trim(); break; }
  }
  return out;
});

// Board Q Readiness teaser: raw mastered count must agree with Board
// Readiness's own "Questions mastered" stat (4, checked above) - both sum
// G.board.isMasteredSrs(srs) across the same board-question corpus, just
// grouped differently (by category here vs. flat total there).
const progMasteredMatch = progress.bqHint && progress.bqHint.match(/^(\d+)\s+mastered/);
progMasteredMatch && parseInt(progMasteredMatch[1], 10) === 4
  ? ok(`Progress's Board Q Readiness teaser reads "${progress.bqHint}" (4 mastered, matches Board Readiness)`)
  : bad(`Progress mastered count: expected 4 mastered, got "${progress.bqHint}"`);

// Same teaser's raw due count must agree with Home's due-count card, Board
// Drill's due chip, and Board Readiness's own "Due for review now" stat
// (all 5, checked above) - same G.board.isDueSrs predicate.
const progDueMatch = progress.bqHint && progress.bqHint.match(/(\d+)\s+due for review/);
progDueMatch && parseInt(progDueMatch[1], 10) === 5
  ? ok(`Progress's Board Q Readiness teaser reads "${progress.bqHint}" (5 due, matches Home/Board Drill/Board Readiness)`)
  : bad(`Progress due count: expected 5 due, got "${progress.bqHint}"`);

const progStreakMatch = progress.streakStat && progress.streakStat.match(/(\d+)d\s*\(best:\s*(\d+)d\)/);
progStreakMatch && parseInt(progStreakMatch[1], 10) === 4 && parseInt(progStreakMatch[2], 10) === 6
  ? ok(`Progress's Weekly Study Goal streak reads "${progress.streakStat}" (matches Home's 4/best 6)`)
  : bad(`Progress streak stat: expected 4d (best: 6d), got "${progress.streakStat}"`);

// ═══════════════════════════════════════════════════════════════════════
// TRANSITION — ETS banner, independently rendered from Home's.
// ═══════════════════════════════════════════════════════════════════════
await page.evaluate(() => { location.hash = "#/transition"; });
await page.waitForTimeout(1000);

const transition = await page.evaluate(() => {
  const el = document.querySelector(".tx-countdown-days");
  return { days: el ? parseInt(el.textContent.trim(), 10) : null, color: el ? getComputedStyle(el).color : null };
});
transition.days === 45 ? ok("Transition's ETS banner reads 45 days out (matches Home)") : bad("Transition ETS days: expected 45, got " + transition.days);
band(transition.color) === "amber" ? ok("Transition's ETS banner colour is amber (matches Home)") : bad("Transition ETS colour band: " + band(transition.color));

// ═══════════════════════════════════════════════════════════════════════
// CALENDAR — both ETS and board-date rows, each independently computed
// from the same profile/settings fields Home and Transition read.
// ═══════════════════════════════════════════════════════════════════════
await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(1000);

const calendar = await page.evaluate(() => {
  function row(labelText) {
    for (const c of document.querySelectorAll(".card")) {
      const k = c.querySelector(".k"), v = c.querySelector(".v");
      if (k && v && k.textContent.trim() === labelText) {
        return { value: v.textContent.trim(), color: getComputedStyle(c).borderLeftColor };
      }
    }
    return null;
  }
  return { ets: row("ETS date"), board: row("Promotion board") };
});
const calEtsDays = calendar.ets ? parseInt(calendar.ets.value, 10) : null;
calEtsDays === 45 ? ok("Calendar's ETS row reads 45 days out (matches Home/Transition)") : bad("Calendar ETS days: expected 45, got " + calEtsDays + " (raw: " + JSON.stringify(calendar.ets) + ")");
calendar.ets && band(calendar.ets.color) === "amber" ? ok("Calendar's ETS row colour is amber (matches Home/Transition)") : bad("Calendar ETS colour band: " + (calendar.ets && band(calendar.ets.color)));

const calBoardDays = calendar.board ? parseInt(calendar.board.value, 10) : null;
calBoardDays === 10 ? ok("Calendar's board-date row reads 10 days out (matches Home)") : bad("Calendar board-date days: expected 10, got " + calBoardDays + " (raw: " + JSON.stringify(calendar.board) + ")");
calendar.board && band(calendar.board.color) === "amber" ? ok("Calendar's board-date row colour is amber (matches Home)") : bad("Calendar board-date colour band: " + (calendar.board && band(calendar.board.color)));

// ═══════════════════════════════════════════════════════════════════════
// MY IDP — the Develop tab's own dashboard, vs. Home's readiness tile.
// ═══════════════════════════════════════════════════════════════════════
await page.evaluate(() => { location.hash = "#/develop"; });
await page.waitForTimeout(700);
await page.locator("button", { hasText: /^My IDP$/ }).click();
await page.waitForTimeout(500);

const idpDash = await page.evaluate(() => {
  const el = document.querySelector(".idp-dash-label");
  return el ? el.textContent.trim() : null;
});
const idpDashMatch = idpDash && idpDash.match(/^(\d+)\s+of\s+(\d+)\s+goals complete/);
idpDashMatch && parseInt(idpDashMatch[1], 10) === 2 && parseInt(idpDashMatch[2], 10) === 5
  ? ok(`My IDP's own dashboard reads "${idpDash}" (2/5, matches Home's tile)`)
  : bad(`My IDP dashboard: expected "2 of 5 goals complete...", got "${idpDash}"`);

// ── Console hygiene, same bar every other suite in this repo holds to. ────
noise.length === 0 ? ok("no console errors/warnings across all six screens") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `CONSISTENCY-EXTENDED: ${fails} FAILURE(S)` : "CONSISTENCY-EXTENDED: all passed"));
process.exit(fails ? 1 : 0);
