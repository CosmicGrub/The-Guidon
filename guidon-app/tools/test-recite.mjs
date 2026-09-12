/**
 * #/recite (Recitation Drill, views.recite in src/index.html) - Milestone 3
 * of docs/design/content-education-roadmap.md, shipped direct-to-main
 * (commit 73d749e) alongside #/creeds, with zero test-suite coverage of its
 * own until now. Round 9 roadmap-audit's test-coverage lens flagged this
 * alongside #/prt and #/creeds as the single highest-value gap - see
 * tools/test-prt.mjs's header for the full rationale shared by all three
 * new suites this round adds.
 *
 * Three things covered here, none previously exercised anywhere:
 *
 *  (a) store.recitable()'s filter: category==="Creeds" AND a real,
 *      non-empty `lines` array - src/index.html's own comment on this
 *      accessor (~lines 7952-7960) explains it was deliberately scoped to
 *      the 3 re-homed full creeds (creed-4/-5/-7) and no other
 *      Creeds-category row, since the rest are short recall-trivia
 *      questions with no `lines` to recite. Ground truth is read live from
 *      window.GUIDON_SEED.board.questions rather than hardcoded, so this
 *      stays correct if the seed content changes - same discipline
 *      tools/test-doctrine-tier-range-filter.mjs already established.
 *
 *  (b) util.firstLetterPrompt()'s regex (`/\b([A-Za-z])[A-Za-z']*\b/g`) -
 *      the exact worked example from its own header comment ("I am an
 *      American Soldier..." -> "I a a A S."), an empty/null-safe input, a
 *      punctuation-heavy input, and two real quirks of this specific regex
 *      confirmed by direct execution rather than assumed: an apostrophe
 *      inside a word (e.g. "I'm") is absorbed into the SAME token as the
 *      letter before it (matched and replaced as one unit, "I'm" -> "I",
 *      not two separate replacements), and a token that mixes a leading
 *      letter with trailing digits (e.g. a rank like "E5") fails to match
 *      the trailing `\b` boundary at all (digits are `\w`, so there is no
 *      word-boundary between a letter and an immediately-following digit)
 *      and passes through completely UNCHANGED rather than reducing to
 *      just its first letter.
 *
 *  (c) A real round-trip: Chunk & Memorize's forward/backwards-chaining
 *      direction AND its per-line chunksLearned progress both persist to
 *      IndexedDB under the `recite:<id>` kv key ACROSS A RELOAD (not just
 *      across a re-render in the same page) - proving this is real
 *      storage, not in-memory closure state that happens to survive until
 *      the tab closes. Reload re-triggers onboarding for a guest-session
 *      profile (in-memory only), so this dismisses it again exactly the
 *      way tools/test-essay-drill.mjs's own reload step already does.
 *
 * Plus a light real route/DOM pass (heading, the list showing exactly the
 * real recitable creeds) so this isn't pure function-level testing with no
 * browser-rendered assertion at all - matching tools/test-landnav-drill.mjs/
 * tools/test-moi-import.mjs's own "launch, route to the hash, assert real
 * DOM/state, plus a targeted Node-level check of the pure functions
 * underneath" structure.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await dismissOnboarding(page);
await page.waitForTimeout(300);

// Clean slate: this kv row can carry state across runs on a shared profile
// (same discipline tools/test-moi-import.mjs already applies to its own key).
await page.evaluate(async () => { await window.G.db.put("kv", { k: "recite:creed-7", v: null }); });

/* ========================================================================
   (a) store.recitable() filter, ground truth read live from the real seed
   ======================================================================== */
const truth = await page.evaluate(() => {
  const qs = window.GUIDON_SEED.board.questions || [];
  const creedsCategory = qs.filter((q) => q.category === "Creeds");
  const withLines = creedsCategory.filter((q) => Array.isArray(q.lines) && q.lines.length > 0);
  const withoutLines = creedsCategory.filter((q) => !(Array.isArray(q.lines) && q.lines.length > 0));
  return {
    withLinesIds: withLines.map((q) => q.id).sort(),
    withoutLinesIds: withoutLines.map((q) => q.id).sort(),
    creedsCategoryCount: creedsCategory.length,
  };
});
truth.withLinesIds.length > 0 && truth.withoutLinesIds.length > 0
  ? ok(`seed ground truth: ${truth.creedsCategoryCount} Creeds-category questions, ${truth.withLinesIds.length} with real lines[] (${JSON.stringify(truth.withLinesIds)}), ${truth.withoutLinesIds.length} without`)
  : bad("seed does not have both lines[] and no-lines Creeds-category questions to test the filter boundary against - has the seed changed shape?");

const recitableIds = await page.evaluate(() => window.G.store.recitable().map((q) => q.id).sort());
JSON.stringify(recitableIds) === JSON.stringify(truth.withLinesIds)
  ? ok(`store.recitable() returns exactly the ${truth.withLinesIds.length} Creeds-category rows with real lines[]: ${JSON.stringify(recitableIds)}`)
  : bad(`store.recitable() -> ${JSON.stringify(recitableIds)}, expected ${JSON.stringify(truth.withLinesIds)}`);

const noneOfExcludedLeakedIn = await page.evaluate(() => {
  const ids = new Set(window.G.store.recitable().map((q) => q.id));
  return window.GUIDON_SEED.board.questions
    .filter((q) => q.category === "Creeds" && !(Array.isArray(q.lines) && q.lines.length > 0))
    .every((q) => !ids.has(q.id));
});
noneOfExcludedLeakedIn
  ? ok("none of the lines-less Creeds-category questions (short recall trivia, not recitable text) leaked into store.recitable()")
  : bad("a Creeds-category question with no real lines[] incorrectly appeared in store.recitable()");

const shapeOk = await page.evaluate(() =>
  window.G.store.recitable().every((q) => q.category === "Creeds" && Array.isArray(q.lines) && q.lines.length > 0));
shapeOk
  ? ok("every item store.recitable() returns genuinely carries category:'Creeds' and a non-empty lines[]")
  : bad("at least one store.recitable() item does not actually satisfy its own documented filter");

/* ========================================================================
   Real route/DOM pass: #/recite lists exactly the real recitable creeds
   ======================================================================== */
await page.evaluate(() => { location.hash = "#/recite"; });
await page.waitForTimeout(500);

const headingShown = await page.evaluate(() => /Recitation Drill/.test(document.querySelector("h2")?.textContent || ""));
headingShown ? ok("#/recite renders with a 'Recitation Drill' heading") : bad("'Recitation Drill' heading not found");

const listTitles = await page.evaluate(() =>
  [...document.querySelectorAll(".list-detail-list .ldr-name")].map((el) => el.textContent).sort());
const expectedTitleCount = truth.withLinesIds.length;
listTitles.length === expectedTitleCount
  ? ok(`#/recite's list shows exactly ${expectedTitleCount} recitable creed(s): ${JSON.stringify(listTitles)}`)
  : bad(`#/recite's list shows ${listTitles.length} row(s), expected ${expectedTitleCount}: ${JSON.stringify(listTitles)}`);

/* ========================================================================
   (b) util.firstLetterPrompt() - pure display transform
   ======================================================================== */
const FLP_CASES = [
  { in: "I am an American Soldier.", want: "I a a A S.", desc: "the worked example from firstLetterPrompt's own header comment" },
  { in: "", want: "", desc: "empty string stays empty" },
  { in: null, want: "", desc: "null input is coerced to \"\" (String(text||\"\")), never throws" },
  { in: "Duty, Honor, Country", want: "D, H, C", desc: "punctuation between words is preserved untouched" },
  { in: "I'm here", want: "I h", desc: "an apostrophe inside a word is absorbed into the SAME match as the letter before it (\"I'm\" -> \"I\" as one replacement, not two)" },
  { in: "Rank E5 today", want: "R E5 t", desc: "a letter immediately followed by a digit (\"E5\") has no word-boundary between them, so the whole token fails to match and passes through UNCHANGED, not reduced to \"E\"" },
];
const flpResults = await page.evaluate((cases) => cases.map((c) => window.G.util.firstLetterPrompt(c.in)), FLP_CASES);
flpResults.forEach((got, i) => {
  got === FLP_CASES[i].want
    ? ok(`firstLetterPrompt(${JSON.stringify(FLP_CASES[i].in)}) -> ${JSON.stringify(got)} - ${FLP_CASES[i].desc}`)
    : bad(`firstLetterPrompt(${JSON.stringify(FLP_CASES[i].in)}): expected ${JSON.stringify(FLP_CASES[i].want)}, got ${JSON.stringify(got)}`);
});

/* ========================================================================
   (c) Chunk & Memorize: forward/backwards-chaining direction AND per-line
   progress round-trip through IndexedDB (recite:<id> kv key) across a
   real page reload, using the Ranger Creed (creed-7, 6 lines - the
   shortest of the 3 recitable creeds, to keep the interaction fast)
   ======================================================================== */
function selectRangerCreed() {
  return page.evaluate(() => {
    const row = [...document.querySelectorAll(".list-detail-list .list-detail-row")].find((r) => /Ranger Creed/.test(r.textContent || ""));
    if (row) { row.click(); return true; }
    return false;
  });
}
function openChunkMode() {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll(".search-filters button")].find((b) => /Chunk & memorize/.test(b.textContent || ""));
    if (btn) { btn.click(); return true; }
    return false;
  });
}
function readChunkState() {
  return page.evaluate(() => {
    const hint = [...document.querySelectorAll(".hint")].find((h) => /line\(s\) locked in/.test(h.textContent || ""));
    // Round 9's list-detail-focus/UX-consistency bucket restyled these as a
    // chip pair (button.chip.search-chip.active + a real aria-pressed),
    // matching every other toggle group in the app - not the earlier plain
    // button.btn.primary markup. Check aria-pressed, the authoritative,
    // accessibility-relevant signal that fix was specifically about.
    const backActive = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Backwards chaining")?.getAttribute("aria-pressed") === "true";
    const fwdActive = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Forward")?.getAttribute("aria-pressed") === "true";
    // Line rows are .card elements nested INSIDE the outer exercise-detail
    // .card (unlike that outer card, which is a direct child of the
    // detail pane) - ".card .card" isolates exactly the per-line rows.
    const rows = [...document.querySelectorAll(".card .card")];
    const firstRowText = rows[0] ? (rows[0].querySelector("p")?.textContent || null) : null;
    const firstRowBtnText = rows[0] ? (rows[0].querySelector("button")?.textContent.trim() || null) : null;
    return { hintText: hint ? hint.textContent : null, backActive: !!backActive, fwdActive: !!fwdActive, firstRowText, firstRowBtnText, rowCount: rows.length };
  });
}

const step1Selected = await selectRangerCreed();
step1Selected ? ok("Selected 'Ranger Creed' from the recitable list") : bad("'Ranger Creed' row not found in the list");
const step1Opened = await openChunkMode();
step1Opened ? ok("Opened 'Chunk & memorize' mode") : bad("'Chunk & memorize' mode chip not found");
await page.waitForTimeout(250);

const initial = await readChunkState();
initial.hintText === "0 / 6 line(s) locked in" && initial.fwdActive && !initial.backActive
  ? ok(`Fresh Chunk & Memorize state defaults to Forward, "0 / 6 line(s) locked in": ${JSON.stringify(initial)}`)
  : bad("unexpected initial Chunk & Memorize state: " + JSON.stringify(initial));

// ---- switch to backwards chaining ----
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Backwards chaining");
  if (btn) btn.click();
});
await page.waitForTimeout(300); // saveReciteState's IndexedDB write, then renderChunk
const afterBackward = await readChunkState();
afterBackward.backActive && !afterBackward.fwdActive && /^6\.\s/.test(afterBackward.firstRowText || "")
  ? ok(`Switching to Backwards chaining reverses the line order (first rendered row is now line 6: "${afterBackward.firstRowText}")`)
  : bad("state after switching to Backwards chaining: " + JSON.stringify(afterBackward));

// ---- mark the (backward-first, i.e. line 6) row learned ----
const marked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".card .card")];
  const btn = rows[0] && [...rows[0].querySelectorAll("button")].find((b) => /Mark learned/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
marked ? ok("Clicked 'Mark learned' on line 6 (the first row shown in backwards-chaining order)") : bad("'Mark learned' button not found on the first backward row");
await page.waitForTimeout(300);
const afterMark = await readChunkState();
afterMark.hintText === "1 / 6 line(s) locked in" && afterMark.firstRowBtnText === "✓ Learned"
  ? ok(`Marking line 6 learned updates the count to "1 / 6 line(s) locked in" and the row now reads "✓ Learned"`)
  : bad("state after marking line 6 learned: " + JSON.stringify(afterMark));

// ---- confirm the write actually landed in IndexedDB before touching the page again ----
const kvBeforeReload = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "recite:creed-7");
  return r && r.v;
});
kvBeforeReload && kvBeforeReload.direction === "backward" && JSON.stringify(kvBeforeReload.chunksLearned) === JSON.stringify([5])
  ? ok(`kv row "recite:creed-7" holds the real state before reload: ${JSON.stringify(kvBeforeReload)}`)
  : bad('kv row "recite:creed-7" before reload: ' + JSON.stringify(kvBeforeReload));

// ---- the actual round trip: reload the page, dismiss the guest-session
// onboarding it re-triggers (same idiom tools/test-essay-drill.mjs's own
// reload step already establishes), then confirm the SAME state renders
// from a cold load, not from any in-memory closure ----
await page.reload({ waitUntil: "load" });
await dismissOnboarding(page);
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = "#/recite"; });
await page.waitForTimeout(500);

const step2Selected = await selectRangerCreed();
step2Selected ? ok("(after reload) re-selected 'Ranger Creed'") : bad("(after reload) 'Ranger Creed' row not found");
const step2Opened = await openChunkMode();
step2Opened ? ok("(after reload) re-opened 'Chunk & memorize' mode") : bad("(after reload) 'Chunk & memorize' mode chip not found");
await page.waitForTimeout(300); // loadReciteState's own IndexedDB read

const afterReload = await readChunkState();
afterReload.backActive && !afterReload.fwdActive
  ? ok("(after reload) Backwards-chaining direction survived the reload")
  : bad("(after reload) direction did not persist: " + JSON.stringify(afterReload));
afterReload.hintText === "1 / 6 line(s) locked in"
  ? ok('(after reload) progress count still reads "1 / 6 line(s) locked in"')
  : bad("(after reload) progress count: " + JSON.stringify(afterReload.hintText));
/^6\.\s/.test(afterReload.firstRowText || "") && afterReload.firstRowBtnText === "✓ Learned"
  ? ok(`(after reload) line 6 still shows "✓ Learned" in the same backward-first position: "${afterReload.firstRowText}"`)
  : bad("(after reload) first-row learned state: " + JSON.stringify({ text: afterReload.firstRowText, btn: afterReload.firstRowBtnText }));

// Leave no trace in the shared profile's kv store.
await page.evaluate(async () => { await window.G.db.put("kv", { k: "recite:creed-7", v: null }); });

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRECITE: all passed");
process.exit(fails ? 1 : 0);
