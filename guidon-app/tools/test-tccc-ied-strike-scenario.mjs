/**
 * Casualty-care-and-cohesion design pass (docs/design/casualty-care-and-
 * cohesion.md §2b, "TCCC-first" build order): the first real interactive
 * TCCC content GUIDON ships. Before this, TCCC had a doctrine card and
 * static board questions — zero interactive content (confirmed by this
 * session's own current-state audit).
 *
 * Deliberately built as a pure content addition on the UNMODIFIED
 * G.engine (same public API — G.engine.run(id, mode, container, onExit) —
 * and the same nodes/choices/goto/score/flags/requires schema all 182
 * existing scenarios already use) rather than a new engine capability, per
 * the design doc's own sequencing note: prove real TCCC content plays well
 * on the shared production engine before any new schema concept (a
 * "vitals" display, a "discuss" cohesion node) is ever added. The
 * "MARCH consequence" effect — a mishandled step costing something real —
 * is achieved entirely through the engine's existing flags + requires-
 * gated-choice-visibility mechanism: a wrong choice sets a flag, and the
 * debrief node's three mutually-exclusive `requires` conditions route to
 * one of three distinct endings depending on which flags got set. No new
 * node/choice field, no engine code touched.
 *
 * Content grounded in the real, current ATP 4-02.11 (23 March 2026) text
 * fetched and pdftotext'd this session (the same source doc-tccc's own
 * MARCH-PAWS fix was verified against) — Care Under Fire priority
 * (suppress before moving to an exposed casualty), M always first ("if
 * massive bleeding is not controlled, go back to M"), and H as a
 * commonly-skipped step ("a real risk even in warm weather").
 *
 * Same two-pattern discipline as the existing engine tests:
 * test-train-mode-guard.mjs's direct G.engine.run() call (so branch-path
 * coverage doesn't depend on Train's card/search UI) for the exhaustive
 * ending checks, plus one real click-through via the actual #/train route
 * (test-train.mjs's own pattern) proving a Soldier can actually find and
 * launch this scenario through the real UI.
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
    const sc = window.G.store.scenario("sc-tccc-ied-strike");
    if (!sc) return { found: false };
    const v = window.G.author && window.G.author.validate ? window.G.author.validate(sc) : null;
    return { found: true, doctrineRef: sc.doctrine && sc.doctrine[0] && sc.doctrine[0].ref, competency: sc.competency, tier: sc.tier, nodeCount: Object.keys(sc.nodes).length, validate: v };
  });
  truth.found ? ok('seed ground truth: found scenario "sc-tccc-ied-strike"') : bad("sc-tccc-ied-strike not found in GUIDON_SEED.scenarios.scenarios");
  truth.doctrineRef === "ATP 4-02.11" ? ok("cites the real, current ATP 4-02.11 (not the superseded TC 4-02.1)") : bad("wrong/missing doctrine ref: " + truth.doctrineRef);
  (truth.validate && truth.validate.ok === true && (truth.validate.errors || []).length === 0)
    ? ok("G.author.validate() (the same validator the Authoring Studio itself uses) reports zero structural issues - no dangling goto/requires targets, no missing prompts")
    : bad("G.author.validate() found issues: " + JSON.stringify(truth.validate));
  noise.length === 0 ? ok("no console noise loading the seed") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

// ---- helpers for driving a detached G.engine.run() session ----
async function boot(page) {
  await page.evaluate(() => {
    document.querySelectorAll("#tccc-test-host").forEach((n) => n.remove());
    const d = document.createElement("div");
    d.id = "tccc-test-host";
    document.body.appendChild(d);
    window.G.engine.run("sc-tccc-ied-strike", "cyoa", d, null);
  });
  await page.waitForTimeout(250);
}
async function clickChoice(page, textPattern) {
  const found = await page.evaluate((p) => {
    const btns = Array.from(document.querySelectorAll("#tccc-test-host button"));
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
    const btns = Array.from(document.querySelectorAll("#tccc-test-host button"));
    const c = btns.find((b) => /Continue/i.test(b.textContent || "") && !b.disabled);
    if (c) c.click();
  });
  await page.waitForTimeout(150);
}
async function hostText(page) {
  return page.evaluate(() => document.querySelector("#tccc-test-host")?.textContent || "");
}
async function attemptsFor(page) {
  return page.evaluate(async () => (await window.G.db.allAttempts()).filter((a) => a.scenarioId === "sc-tccc-ied-strike"));
}

/* ---- Path 1: every choice correct -> the "textbook" ending ---- */
{
  const { page, noise } = await newPage();
  await boot(page);
  const c1 = await clickChoice(page, "Direct return fire"); c1 ? ok("textbook path: n1 suppress-first choice found") : bad("n1 suppress choice missing"); await clickAdvance(page);
  const c2 = await clickChoice(page, "Apply a tourniquet high and tight"); c2 ? ok("textbook path: M (tourniquet) choice found") : bad("M choice missing"); await clickAdvance(page);
  const c3 = await clickChoice(page, "Continue: check airway"); c3 ? ok("textbook path: A/R/C continue found") : bad("A/R/C continue missing"); await clickAdvance(page);
  const c4 = await clickChoice(page, "wrap him in a hypothermia"); c4 ? ok("textbook path: H (hypothermia) correct choice found") : bad("H correct choice missing"); await clickAdvance(page);
  const c5 = await clickChoice(page, "Continue: call in the 9-line"); c5 ? ok("textbook path: 9-line handoff found") : bad("9-line handoff missing"); await clickAdvance(page);
  const c6 = await clickChoice(page, "^Continue$"); c6 ? ok("textbook path: debrief continue found") : bad("debrief continue missing"); await clickAdvance(page);

  const text = await hostText(page);
  /it's not a checklist to complete eventually, it's an order to follow/i.test(text)
    ? ok('reached the correct "textbook" ending outcome text (all flags clear)')
    : bad("did not reach the textbook ending: " + text.slice(-300));

  const attempts = await attemptsFor(page);
  (attempts.length === 1 && attempts[0].score && attempts[0].score.Achieves === 7 && attempts[0].score.Leads === 3 && attempts[0].score.Character === 2)
    ? ok(`real store.recordAttempt() row written with the exact expected score (Achieves:7, Leads:3, Character:2) - ${JSON.stringify(attempts[0].score)}`)
    : bad("attempt row missing or score mismatch: " + JSON.stringify(attempts));

  noise.length === 0 ? ok("no console noise across the textbook playthrough") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ---- Path 2: ignore Care Under Fire priority -> the "exposed" ending (worst tier, regardless of later correctness) ---- */
{
  const { page, noise } = await newPage();
  await boot(page);
  await clickChoice(page, "Sprint straight to Reyes"); await clickAdvance(page);
  await clickChoice(page, "Apply a tourniquet high and tight"); await clickAdvance(page);
  await clickChoice(page, "Continue: check airway"); await clickAdvance(page);
  await clickChoice(page, "wrap him in a hypothermia"); await clickAdvance(page); // gets M and H right, but no_suppression already set
  await clickChoice(page, "Continue: call in the 9-line"); await clickAdvance(page);
  await clickChoice(page, "^Continue$"); await clickAdvance(page);

  const text = await hostText(page);
  /Care Under Fire exists precisely because the fastest way to lose more people/i.test(text)
    ? ok('no_suppression flag correctly routes to the "exposed" ending even when every later MARCH choice was correct - Care Under Fire priority is treated as the more severe sequencing error')
    : bad("did not reach the exposed ending: " + text.slice(-300));
  !/it's not a checklist to complete eventually/i.test(text)
    ? ok("exposed ending text is genuinely distinct from the textbook ending (real branching, not the same text shown twice)")
    : bad("exposed path incorrectly shows the textbook ending text");

  noise.length === 0 ? ok("no console noise across the exposed-path playthrough") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ---- Path 3: correct CUF + M, but skip hypothermia prevention -> the "gaps" ending ---- */
{
  const { page, noise } = await newPage();
  await boot(page);
  await clickChoice(page, "Direct return fire"); await clickAdvance(page);
  await clickChoice(page, "Apply a tourniquet high and tight"); await clickAdvance(page);
  await clickChoice(page, "Continue: check airway"); await clickAdvance(page);
  const wrongH = await clickChoice(page, "Leave him as-is for now"); wrongH ? ok("gaps path: missed-hypothermia wrong choice found") : bad("missed-hypothermia choice missing");
  await clickAdvance(page);
  await clickChoice(page, "Continue: call in the 9-line"); await clickAdvance(page);
  await clickChoice(page, "^Continue$"); await clickAdvance(page);

  const text = await hostText(page);
  /doesn't save time, it just moves the cost downstream/i.test(text)
    ? ok('missed_h flag (with no_suppression clear) correctly routes to the "gaps" ending - a real third, distinct outcome')
    : bad("did not reach the gaps ending: " + text.slice(-300));

  noise.length === 0 ? ok("no console noise across the gaps-path playthrough") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ---- Path 4: the "go back to M" recovery detour still reaches the SAME tourniquet step ---- */
{
  const { page, noise } = await newPage();
  await boot(page);
  await clickChoice(page, "Direct return fire"); await clickAdvance(page);
  const wrongM = await clickChoice(page, "Check his airway first"); wrongM ? ok("go-back-to-M path: missed-M wrong choice found") : bad("missed-M choice missing");
  await clickAdvance(page);
  const recoveryText = await hostText(page);
  /go back to M/i.test(recoveryText)
    ? ok('the missed-M detour node explicitly teaches "go back to M" before letting the tourniquet be applied')
    : bad("missed-M detour text missing the go-back-to-M lesson: " + recoveryText.slice(-300));
  const recoveryChoice = await clickChoice(page, "Apply the tourniquet now"); recoveryChoice ? ok("recovery choice (apply tourniquet now) found on the detour node") : bad("recovery choice missing");
  await clickAdvance(page);
  const afterRecovery = await hostText(page);
  /The tourniquet cinches down two fingers above the wound/i.test(afterRecovery)
    ? ok("after the M detour, play correctly rejoins the main sequence at n3 (tourniquet applied)")
    : bad("did not rejoin the main sequence after the M detour: " + afterRecovery.slice(-300));

  noise.length === 0 ? ok("no console noise across the go-back-to-M detour") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ---- Real end-to-end reachability via the actual #/train route (not just G.engine.run() directly) ---- */
{
  const { page, noise } = await newPage();
  await page.evaluate(() => { location.hash = "#/train"; });
  await page.waitForTimeout(600);
  const search = page.locator('input[placeholder*="Search"]').first();
  await search.fill("IED Strike");
  await page.waitForTimeout(300);
  const cardVisible = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".grid .card.click"));
    return cards.some((c) => /Contact: IED Strike/.test(c.textContent || ""));
  });
  cardVisible ? ok('a real Soldier searching "IED Strike" on #/train finds the scenario card') : bad('scenario card not found via #/train search for "IED Strike"');
  if (cardVisible) {
    await page.locator(".grid .card.click", { hasText: "Contact: IED Strike" }).first().click();
    await page.waitForTimeout(400);
    const launched = await page.evaluate(() => /IED STRIKE/.test(document.body.textContent || ""));
    launched ? ok("clicking the real card launches the scenario through the real Train UI") : bad("clicking the card did not launch the scenario");
  }
  noise.length === 0 ? ok("no console noise navigating #/train and launching via the real UI") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

console.log(fails === 0 ? "\nTCCC IED STRIKE SCENARIO: all passed" : `\nTCCC IED STRIKE SCENARIO: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
