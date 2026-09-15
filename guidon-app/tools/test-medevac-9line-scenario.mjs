/**
 * Casualty-care-and-cohesion design pass (docs/design/casualty-care-and-
 * cohesion.md §2b, "TCCC-first" build order, second item after
 * sc-tccc-ied-strike): the first interactive 9-line MEDEVAC content
 * GUIDON ships. Before this, the 9-line existed only as static board-
 * question answers - zero doctrine entry (fixed separately, doc-medevac-
 * 9line) and zero interactive drill/builder.
 *
 * Matches the design doc's exact spec: "a fixed 9-node graph, each line
 * offering 3-4 plausible values including real wrong answers... keep a
 * wartime/peacetime branch on line 9 [and line 6] as a genuine
 * comprehension check" - every line is a multiple-choice decision (never
 * free text), sidestepping the free-text grading fragility every design
 * candidate flagged as a real risk. Built on the exact same unmodified
 * G.engine schema as sc-tccc-ied-strike (nodes/choices/goto/score/flags/
 * requires) - zero new engine capability, pure content, narratively a
 * direct sequel ("Reyes is stabilized... call in the 9-line").
 *
 * Content verified against the real ATP 4-02.2 (12 July 2019) Appendix C,
 * Table C-1 text extracted this session (the same source doc-medevac-
 * 9line's own doctrine entry was built from) - precedence codes,
 * equipment codes, security codes, marking codes, nationality codes, and
 * the wartime/peacetime meaning-swap on Lines 6 and 9 are all real,
 * sourced values, not invented ones.
 *
 * Same discipline as test-tccc-ied-strike-scenario.mjs: direct
 * G.engine.run() calls into a detached host for exhaustive branch-path
 * coverage, plus one real click-through via the actual #/train route.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function newPage() {
  const page = await (await browser.newContext()).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  return { page, noise };
}

// ---- ground truth + G.author's own validator ----
{
  const { page, noise } = await newPage();
  const truth = await page.evaluate(() => {
    const sc = window.G.store.scenario("sc-medevac-9line-callin");
    if (!sc) return { found: false };
    const v = window.G.author && window.G.author.validate ? window.G.author.validate(sc) : null;
    return { found: true, doctrineRef: sc.doctrine && sc.doctrine[0] && sc.doctrine[0].ref, nodeCount: Object.keys(sc.nodes).length, validate: v };
  });
  truth.found ? ok('seed ground truth: found scenario "sc-medevac-9line-callin"') : bad("sc-medevac-9line-callin not found");
  truth.doctrineRef === "ATP 4-02.2" ? ok("cites the real ATP 4-02.2 (the 9-line's actual source publication)") : bad("wrong/missing doctrine ref: " + truth.doctrineRef);
  truth.nodeCount === 13 ? ok("13 nodes (9 line-decision nodes + n_end + 3 endings)") : bad("unexpected node count: " + truth.nodeCount);
  (truth.validate && truth.validate.ok === true && (truth.validate.errors || []).length === 0)
    ? ok("G.author.validate() reports zero structural issues")
    : bad("G.author.validate() found issues: " + JSON.stringify(truth.validate));
  noise.length === 0 ? ok("no console noise loading the seed") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

async function boot(page) {
  await page.evaluate(() => {
    document.querySelectorAll("#m9-test-host").forEach((n) => n.remove());
    const d = document.createElement("div"); d.id = "m9-test-host"; document.body.appendChild(d);
    window.G.engine.run("sc-medevac-9line-callin", "cyoa", d, null);
  });
  await page.waitForTimeout(250);
}
async function clickChoice(page, textPattern) {
  const found = await page.evaluate((p) => {
    const btns = Array.from(document.querySelectorAll("#m9-test-host button"));
    const btn = btns.find((b) => new RegExp(p).test(b.textContent || "") && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  }, textPattern);
  await page.waitForTimeout(150);
  return found;
}
async function clickAdvance(page) {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("#m9-test-host button"));
    const c = btns.find((b) => /Continue/i.test(b.textContent || "") && !b.disabled);
    if (c) c.click();
  });
  await page.waitForTimeout(150);
}
async function hostText(page) { return page.evaluate(() => document.querySelector("#m9-test-host")?.textContent || ""); }
async function attemptsFor(page) {
  return page.evaluate(async () => (await window.G.db.allAttempts()).filter((a) => a.scenarioId === "sc-medevac-9line-callin"));
}

const CORRECT_LINES = [
  "six-digit MGRS grid coordinates",
  "The frequency and call sign for THIS radio",
  "B — one Urgent Surgical",
  "A — None",
  "L\\+1 — one litter patient",
  "P — Possibly enemy troops",
  "C — Smoke signal",
  "A — US Military",
  "Omit the line entirely",
];

/* ---- Path 1: all 9 lines correct -> "textbook" ending ---- */
{
  const { page, noise } = await newPage();
  await boot(page);
  let allFound = true;
  for (const line of CORRECT_LINES) {
    const found = await clickChoice(page, line);
    if (!found) allFound = false;
    await clickAdvance(page);
  }
  allFound ? ok("all 9 correct-answer choices found and clicked in order") : bad("one or more correct-answer choices were missing");
  await clickChoice(page, "^Continue$"); await clickAdvance(page);

  const text = await hostText(page);
  /reads the situation correctly line by line/i.test(text)
    ? ok('reached the "textbook" ending with all 9 lines correct')
    : bad("did not reach the textbook ending: " + text.slice(-300));

  const attempts = await attemptsFor(page);
  (attempts.length === 1 && attempts[0].score && attempts[0].score.Achieves === 18 && attempts[0].score.Intellect === 1)
    ? ok(`real store.recordAttempt() row with the exact expected score (Achieves:18 = 9 lines x 2, Intellect:1) - ${JSON.stringify(attempts[0].score)}`)
    : bad("attempt row missing or score mismatch: " + JSON.stringify(attempts));

  noise.length === 0 ? ok("no console noise across the textbook playthrough") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ---- Path 2: peacetime-version wrong choice on Line 6 -> "peacetime confusion" ending, even with everything else correct ---- */
{
  const { page, noise } = await newPage();
  await boot(page);
  await clickChoice(page, "six-digit MGRS"); await clickAdvance(page);
  await clickChoice(page, "The frequency and call sign for THIS radio"); await clickAdvance(page);
  await clickChoice(page, "B — one Urgent Surgical"); await clickAdvance(page);
  await clickChoice(page, "A — None"); await clickAdvance(page);
  await clickChoice(page, "L\\+1 — one litter patient"); await clickAdvance(page);
  const wrongLine6 = await clickChoice(page, "Report the number and type of wound instead"); wrongLine6 ? ok("Line 6 peacetime-version wrong choice found") : bad("Line 6 peacetime choice missing");
  await clickAdvance(page);
  await clickChoice(page, "C — Smoke signal"); await clickAdvance(page);
  await clickChoice(page, "A — US Military"); await clickAdvance(page);
  await clickChoice(page, "Omit the line entirely"); await clickAdvance(page);
  await clickChoice(page, "^Continue$"); await clickAdvance(page);

  const text = await hostText(page);
  /reciting the form from memory/i.test(text)
    ? ok("Line 6's peacetime-version mistake correctly routes to the dedicated wartime/peacetime-confusion ending, even with all 8 other lines correct")
    : bad("did not reach the peacetime-confusion ending: " + text.slice(-300));
  !/reads the situation correctly line by line/i.test(text)
    ? ok("peacetime-confusion ending text is genuinely distinct from the textbook ending")
    : bad("incorrectly shows the textbook ending text");

  noise.length === 0 ? ok("no console noise across the Line-6 peacetime-confusion playthrough") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ---- Path 3: peacetime-version wrong choice on Line 9 also routes to the SAME peacetime-confusion ending ---- */
{
  const { page, noise } = await newPage();
  await boot(page);
  for (const line of CORRECT_LINES.slice(0, 8)) { await clickChoice(page, line); await clickAdvance(page); }
  const wrongLine9 = await clickChoice(page, "A description of the terrain around the pickup site"); wrongLine9 ? ok("Line 9 peacetime-version wrong choice found") : bad("Line 9 peacetime choice missing");
  await clickAdvance(page);
  await clickChoice(page, "^Continue$"); await clickAdvance(page);

  const text = await hostText(page);
  /reciting the form from memory/i.test(text)
    ? ok("Line 9's peacetime-version mistake ALSO correctly routes to the same wartime/peacetime-confusion ending (both flagship comprehension checks wired correctly)")
    : bad("did not reach the peacetime-confusion ending via Line 9: " + text.slice(-300));

  noise.length === 0 ? ok("no console noise across the Line-9 peacetime-confusion playthrough") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ---- Path 4: a non-peacetime mistake (wrong precedence) -> the generic "gaps" ending, distinct from both other endings ---- */
{
  const { page, noise } = await newPage();
  await boot(page);
  await clickChoice(page, "six-digit MGRS"); await clickAdvance(page);
  await clickChoice(page, "The frequency and call sign for THIS radio"); await clickAdvance(page);
  const wrongPrecedence = await clickChoice(page, "^A — one Urgent$"); wrongPrecedence ? ok("wrong-but-plausible precedence choice (A - Urgent, not B - Urgent Surgical) found") : bad("wrong precedence choice missing");
  await clickAdvance(page);
  await clickChoice(page, "A — None"); await clickAdvance(page);
  await clickChoice(page, "L\\+1 — one litter patient"); await clickAdvance(page);
  await clickChoice(page, "P — Possibly enemy troops"); await clickAdvance(page);
  await clickChoice(page, "C — Smoke signal"); await clickAdvance(page);
  await clickChoice(page, "A — US Military"); await clickAdvance(page);
  await clickChoice(page, "Omit the line entirely"); await clickAdvance(page);
  await clickChoice(page, "^Continue$"); await clickAdvance(page);

  const text = await hostText(page);
  /forces the crew to ask a follow-up question/i.test(text)
    ? ok('a non-wartime/peacetime mistake correctly routes to the generic "gaps" ending, distinct from the peacetime-confusion ending')
    : bad("did not reach the gaps ending: " + text.slice(-300));

  noise.length === 0 ? ok("no console noise across the gaps playthrough") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ---- Real end-to-end reachability via the actual #/train route ---- */
{
  const { page, noise } = await newPage();
  await page.evaluate(() => { location.hash = "#/train"; });
  await page.waitForTimeout(600);
  const search = page.locator('input[placeholder*="Search"]').first();
  await search.fill("9-Line MEDEVAC");
  await page.waitForTimeout(300);
  const cardVisible = await page.evaluate(() => Array.from(document.querySelectorAll(".grid .card.click")).some((c) => /Call for Help/.test(c.textContent || "")));
  cardVisible ? ok('a real Soldier searching "9-Line MEDEVAC" on #/train finds the scenario card') : bad("scenario card not found via #/train search");
  if (cardVisible) {
    await page.locator(".grid .card.click", { hasText: "Call for Help" }).first().click();
    await page.waitForTimeout(400);
    const launched = await page.evaluate(() => /MSR TAMPA/.test(document.body.textContent || ""));
    launched ? ok("clicking the real card launches the scenario through the real Train UI") : bad("clicking the card did not launch the scenario");
  }
  noise.length === 0 ? ok("no console noise navigating #/train and launching via the real UI") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

console.log(fails === 0 ? "\nMEDEVAC 9-LINE SCENARIO: all passed" : `\nMEDEVAC 9-LINE SCENARIO: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
