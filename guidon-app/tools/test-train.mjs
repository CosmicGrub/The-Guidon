/**
 * Train (#/train, G.views.train backed by G.engine's scenario player): the
 * generic route sweep only ever confirms the list renders - it never clicks
 * a competency/difficulty chip, types into the (just-debounced, just-capped)
 * search box, launches a real scenario, or clicks through a real choice to a
 * real ending. None of that had interactive coverage before this.
 *
 * This exercises: the default list (182 built-in scenarios, capped at
 * TRAIN_CAP=60 per buildGrid()); the "All / Leadership / Mandatory Training"
 * tabs; the competency and difficulty `.search-chip` filters (each carries a
 * real aria-pressed, and combined with the cap+header text when a filtered
 * count exceeds TRAIN_CAP); the debounced search box narrowing to an exact
 * scenario and its empty-state message; and a full real playthrough of
 * "Counseling: Growing a High Performer" (sc-counsel-growth, course mode) -
 * two real choices, each with real feedback/score text, through to a real
 * "After-Action Review" outcome with the exact score-grid values the engine
 * computed, plus the real store.recordAttempt() row it wrote to IndexedDB.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

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

await page.evaluate(() => { location.hash = "#/train"; });
await page.waitForTimeout(600);

// ---- default list state ----
const totalScenarios = await page.evaluate(() => window.G.store.scenarios().length);
totalScenarios > 60 ? ok("fixture sanity: the built-in catalog has more than TRAIN_CAP (60) scenarios (" + totalScenarios + ")") : bad("catalog unexpectedly small: " + totalScenarios);

const titleShown = await page.evaluate(() => document.querySelector(".section-title h2")?.textContent === "Train");
titleShown ? ok("#/train renders the Train section heading") : bad("Train heading not found");

const initialCardCount = await page.evaluate(() => document.querySelectorAll(".grid .card.click").length);
initialCardCount === 60 ? ok("default view renders exactly TRAIN_CAP (60) scenario cards even though " + totalScenarios + " scenarios exist") : bad("initial card count: " + initialCardCount);

const tabLabels = await page.evaluate(() => Array.from(document.querySelectorAll(".tabbar .tab")).map((b) => b.textContent));
tabLabels[0] === "All (" + totalScenarios + ")" && tabLabels[1] === "Leadership" && tabLabels[2] === "Mandatory Training"
  ? ok("tab bar shows All/Leadership/Mandatory Training with a real total count")
  : bad("unexpected tab labels: " + JSON.stringify(tabLabels));

// ---- "Mandatory Training" tab actually filters ----
await page.locator(".tabbar .tab", { hasText: /Mandatory Training/ }).click();
await page.waitForTimeout(200);
const trainingCount = await page.evaluate(() => window.G.store.scenarios().filter((s) => s.defaultMode === "training").length);
const trainingCardState = await page.evaluate(() => ({
  cards: document.querySelectorAll(".grid .card.click").length,
  badges: document.querySelectorAll(".tr-mandatory-badge").length,
}));
trainingCardState.cards === trainingCount
  ? ok("'Mandatory Training' tab narrows the grid to exactly the " + trainingCount + " training-mode scenarios")
  : bad("training tab card count: " + trainingCardState.cards + " (expected " + trainingCount + ")");
trainingCardState.badges === trainingCount
  ? ok("every card in the Mandatory Training tab carries the MANDATORY TRAINING badge")
  : bad("badge count: " + trainingCardState.badges);

await page.locator(".tabbar .tab", { hasText: /^All/ }).click();
await page.waitForTimeout(200);

// Intuitivism pass, Tier 1(g): the competency/difficulty chip rows moved
// behind a "Filters" toggle (11 always-visible chips collapsed to one).
// A display:none ancestor has no accessible role, so a real
// page.locator().click() on a chip inside it would time out until this
// expands the section first - once, for the whole chip block below.
await page.locator("button", { hasText: /^Filters/ }).click();
await page.waitForTimeout(150);

// ---- competency chip: real filter + aria-pressed + cap/header text ----
const leadsCount = await page.evaluate(() => window.G.store.scenarios().filter((s) => (s.competency || []).includes("Leads")).length);
await page.locator('[aria-label="Filter by competency"] .search-chip', { hasText: /^Leads$/ }).click();
await page.waitForTimeout(200);
const afterLeadsChip = await page.evaluate(() => ({
  cards: document.querySelectorAll(".grid .card.click").length,
  header: document.querySelector(".search-header")?.textContent || "",
  pressed: Array.from(document.querySelectorAll('[aria-label="Filter by competency"] .search-chip')).map((b) => ({ t: b.textContent, p: b.getAttribute("aria-pressed") })),
}));
afterLeadsChip.cards === 60
  ? ok("'Leads' competency chip filters to " + leadsCount + " scenarios, grid still capped at 60")
  : bad("card count after Leads chip: " + afterLeadsChip.cards);
afterLeadsChip.header === leadsCount + " scenarios (showing first 60) · Leads"
  ? ok("search-header reports the real filtered count and the cap note for the Leads chip")
  : bad("header text after Leads chip: " + JSON.stringify(afterLeadsChip.header));
const leadsPressed = afterLeadsChip.pressed.find((c) => c.t === "Leads");
const allCompPressed = afterLeadsChip.pressed.find((c) => c.t === "All competencies");
leadsPressed?.p === "true" && allCompPressed?.p === "false"
  ? ok("clicking 'Leads' sets its own aria-pressed=true and clears 'All competencies'")
  : bad("aria-pressed state after Leads chip: " + JSON.stringify(afterLeadsChip.pressed));

await page.locator('[aria-label="Filter by competency"] .search-chip', { hasText: /^All competencies$/ }).click();
await page.waitForTimeout(200);
const afterCompReset = await page.evaluate(() => document.querySelector('[aria-label="Filter by competency"] .search-chip.active')?.textContent);
afterCompReset === "All competencies" ? ok("'All competencies' resets the competency filter") : bad("active competency chip after reset: " + afterCompReset);

// ---- difficulty chip: real filter, no cap needed at this count ----
const basicCount = await page.evaluate(() => window.G.store.scenarios().filter((s) => s.difficulty === "Basic").length);
await page.locator('[aria-label="Filter by difficulty"] .search-chip', { hasText: /^Basic$/ }).click();
await page.waitForTimeout(200);
const afterBasicChip = await page.evaluate(() => ({
  cards: document.querySelectorAll(".grid .card.click").length,
  header: document.querySelector(".search-header")?.textContent || "",
  pressed: Array.from(document.querySelectorAll('[aria-label="Filter by difficulty"] .search-chip')).map((b) => ({ t: b.textContent, p: b.getAttribute("aria-pressed") })),
}));
afterBasicChip.cards === basicCount
  ? ok("'Basic' difficulty chip filters the grid to exactly " + basicCount + " scenarios (no cap needed)")
  : bad("card count after Basic chip: " + afterBasicChip.cards + " (expected " + basicCount + ")");
afterBasicChip.header === basicCount + " scenario" + (basicCount === 1 ? "" : "s") + " · Basic"
  ? ok("search-header reflects the Basic-only count with no cap note")
  : bad("header text after Basic chip: " + JSON.stringify(afterBasicChip.header));
const basicPressed = afterBasicChip.pressed.find((c) => c.t === "Basic");
basicPressed?.p === "true" ? ok("'Basic' chip's own aria-pressed flips to true") : bad("Basic chip aria-pressed: " + basicPressed?.p);

await page.locator('[aria-label="Filter by difficulty"] .search-chip', { hasText: /^All difficulties$/ }).click();
await page.waitForTimeout(200);

// ---- search box: debounced, narrows to a real single match ----
await page.fill('input[aria-label="Search scenarios"]', "High Performer");
await page.waitForTimeout(300);
const afterSearch = await page.evaluate(() => ({
  cards: document.querySelectorAll(".grid .card.click").length,
  header: document.querySelector(".search-header")?.textContent || "",
  aria: document.querySelector(".grid .card.click")?.getAttribute("aria-label"),
}));
afterSearch.cards === 1 && afterSearch.aria === "Start scenario: Counseling: Growing a High Performer"
  ? ok("searching 'High Performer' narrows the debounced search to the one matching scenario")
  : bad("search result: " + JSON.stringify(afterSearch));
afterSearch.header === "1 scenario · high performer"
  ? ok("search-header reflects the 1-result count and the (lowercased) query")
  : bad("search header text: " + JSON.stringify(afterSearch.header));

// ---- search box: real empty state for a non-matching query ----
await page.fill('input[aria-label="Search scenarios"]', "zzzznonexistentxyz");
await page.waitForTimeout(300);
const emptyState = await page.evaluate(() => ({
  cards: document.querySelectorAll(".grid .card.click").length,
  msg: document.querySelector(".empty")?.textContent || "",
}));
emptyState.cards === 0 && /No scenarios match .zzzznonexistentxyz.\. Try a different term or clear the search\./.test(emptyState.msg)
  ? ok("a non-matching search shows the real zero-result empty message naming the query")
  : bad("empty-search state: " + JSON.stringify(emptyState));

// ---- launch a real scenario and play it through to a real ending ----
await page.fill('input[aria-label="Search scenarios"]', "High Performer");
await page.waitForTimeout(300);
await page.locator(".grid .card.click").first().click();
await page.waitForTimeout(300);

const playerOpened = await page.evaluate(() => ({
  listGridHidden: document.querySelector(".grid")?.offsetParent === null,
  h2: document.querySelector(".engine-head h2")?.textContent,
  eyebrow: document.querySelector(".engine-head .eyebrow")?.textContent,
  sceneTag: document.querySelector(".engine-scene-tag")?.textContent || "",
  activeMode: document.querySelector(".segmented button.active")?.textContent,
}));
playerOpened.listGridHidden ? ok("the scenario list is hidden (display:none) while the player is open") : bad("scenario list grid still visible after launch");
playerOpened.h2 === "Counseling: Growing a High Performer"
  ? ok("clicking the card launches G.engine.run and renders the real scenario header")
  : bad("player header after launch: " + JSON.stringify(playerOpened));
playerOpened.eyebrow === "Intermediate" ? ok("header eyebrow shows the scenario's real difficulty") : bad("eyebrow: " + playerOpened.eyebrow);
/PROFESSIONAL GROWTH COUNSELING/.test(playerOpened.sceneTag) ? ok("header scene tag shows the scenario's real scene text") : bad("scene tag: " + JSON.stringify(playerOpened.sceneTag));
playerOpened.activeMode === "Course" ? ok("the scenario launches in its real defaultMode (Course)") : bad("active mode segment: " + playerOpened.activeMode);

// Node g1: two real choices exist; pick the "good" one by its real title text.
const g1Choices = await page.evaluate(() => Array.from(document.querySelectorAll(".mode-course button.choice")).map((b) => b.getAttribute("title")));
g1Choices.includes("Name the potential you see and make it concrete.") && g1Choices.includes("Keep it light — don't push if she's not asking.")
  ? ok("node g1 renders both of its real authored choices")
  : bad("g1 choice titles: " + JSON.stringify(g1Choices));

await page.locator('.mode-course button.choice[title="Name the potential you see and make it concrete."]').click();
await page.waitForTimeout(200);
const afterChoice1 = await page.evaluate(() => ({
  feedback: document.querySelector(".slide .feedback")?.textContent || "",
  feedbackClass: document.querySelector(".slide .feedback")?.className || "",
  choicesDisabled: Array.from(document.querySelectorAll(".mode-course button.choice")).every((b) => b.disabled),
}));
/Professional growth counseling is proactive/.test(afterChoice1.feedback) && /\+3 Develops/.test(afterChoice1.feedback) && /\+2 Leads/.test(afterChoice1.feedback)
  ? ok("picking the choice reveals its real feedback text and real score deltas (+3 Develops, +2 Leads)")
  : bad("feedback after choice 1: " + JSON.stringify(afterChoice1.feedback));
afterChoice1.feedbackClass === "feedback good" ? ok("a net-positive choice gets the 'good' feedback class") : bad("feedback class: " + afterChoice1.feedbackClass);
afterChoice1.choicesDisabled ? ok("all choice buttons lock after one is picked") : bad("choice buttons did not lock after picking one");

await page.locator(".slide button.btn.primary", { hasText: /Continue/ }).click();
await page.waitForTimeout(200);

// Node g2: a real subsequent node with its own dialogue and single choice.
const g2State = await page.evaluate(() => ({
  beat: document.querySelector(".beat-label")?.textContent || "",
  prompt: document.querySelector(".slide .prompt")?.textContent || "",
  dialogue: document.querySelector(".dl-text")?.textContent || "",
  choiceTitle: document.querySelector(".mode-course button.choice")?.getAttribute("title") || "",
}));
g2State.beat === "THE PLAN — HER GOALS, YOUR MAP" && g2State.prompt === "She's leaning in now."
  ? ok("advancing the choice moves the engine to the real next node (g2), with its real beat + prompt")
  : bad("g2 state: " + JSON.stringify(g2State));
g2State.dialogue === "Okay. So what would I even need to do?" ? ok("g2's real dialogue line renders") : bad("g2 dialogue: " + JSON.stringify(g2State.dialogue));
g2State.choiceTitle === "Co-build a concrete developmental plan across the three domains."
  ? ok("g2 offers its real single choice") : bad("g2 choice title: " + JSON.stringify(g2State.choiceTitle));

await page.locator('.mode-course button.choice[title="Co-build a concrete developmental plan across the three domains."]').click();
await page.waitForTimeout(200);
await page.locator(".slide button.btn.primary", { hasText: /Continue/ }).click();
await page.waitForTimeout(300);

// Real ending: renderOutcome's After-Action Review, with the engine's actual computed grade/score.
const outcome = await page.evaluate(() => ({
  h2: document.querySelector(".panel.outcome h2")?.textContent || "",
  ring: document.querySelector(".ring")?.textContent || "",
  feedback: document.querySelector(".panel.outcome .feedback")?.textContent || "",
  feedbackClass: document.querySelector(".panel.outcome .feedback")?.className || "",
  cells: Array.from(document.querySelectorAll(".score-cell")).map((c) => ({ n: c.querySelector(".n")?.textContent, l: c.querySelector(".l")?.textContent })),
}));
outcome.h2 === "After-Action Review" ? ok("choosing through to the end node renders the real After-Action Review outcome screen") : bad("outcome h2: " + outcome.h2);
outcome.ring === "A" ? ok("the engine computes the real letter grade (A) from the accumulated score (total 11)") : bad("grade ring: " + outcome.ring);
/^DELIBERATE DEVELOPMENT\./.test(outcome.feedback) ? ok("the real end-node outcome text is shown") : bad("outcome feedback: " + JSON.stringify(outcome.feedback.slice(0, 80)));
outcome.feedbackClass === "feedback good" ? ok("a total >= 4 gets the 'good' outcome class") : bad("outcome feedback class: " + outcome.feedbackClass);
const cellMap = Object.fromEntries(outcome.cells.map((c) => [c.l, c.n]));
cellMap.Leads === "+5" && cellMap.Develops === "+6" && cellMap.Achieves === "0" && cellMap.Character === "0" && cellMap.Presence === "0" && cellMap.Intellect === "0"
  ? ok("the score grid shows the real accumulated per-dimension deltas (Leads +5, Develops +6)")
  : bad("score-grid cells: " + JSON.stringify(outcome.cells));

// The real store.recordAttempt() write, not just the DOM.
const attempts = await page.evaluate(async () => (await window.G.db.allAttempts()).filter((a) => a.scenarioId === "sc-counsel-growth"));
attempts.length === 1 ? ok("finishing the scenario writes exactly one attempt row to IndexedDB") : bad("attempt rows for sc-counsel-growth: " + attempts.length);
const att = attempts[0];
att && att.mode === "course" && att.total === 11 && att.choices === 2 && att.outcomeNode === "end_g_best" && att.score?.Leads === 5 && att.score?.Develops === 6
  ? ok("the persisted attempt row's mode/total/choices/outcomeNode/score match the real playthrough")
  : bad("persisted attempt: " + JSON.stringify(att));

// ---- Done returns to the list ----
await page.locator("button", { hasText: /^Done$/ }).click();
await page.waitForTimeout(300);
const backToList = await page.evaluate(() => document.querySelectorAll(".grid .card.click").length > 0);
backToList ? ok("'Done' returns to the scenario list") : bad("scenario list did not reappear after Done");

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `TRAIN: ${fails} FAILURE(S)` : "TRAIN: all passed"));
process.exit(fails ? 1 : 0);
