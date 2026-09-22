/**
 * Integrated Operational Thinking scenarios (ROADMAP.md §3f, Phase 0): three
 * new G.engine scenarios teaching the Vertical-SOP-anchor + Lateral-pivot
 * model - sc-iot-comms-blackout, sc-iot-motorpool-belt, sc-iot-range-safety.
 *
 * Each is a 6-node structure on the UNMODIFIED engine (same
 * nodes/choices/goto/score schema every other scenario uses): a situation
 * node, a 4-way decision node whose four options map to the four leadership
 * response types the design specifies (rigid vertical / reckless lateral /
 * passive / integrated), and four DISTINCT end nodes so every choice's
 * consequence is its own teaching point rather than a shared "wrong" screen.
 *
 * Same two-pattern discipline as test-tccc-ied-strike-scenario.mjs: direct
 * G.engine.run() sessions for exhaustive per-ending coverage (so branch
 * coverage doesn't depend on Train's card/search UI), plus one real
 * click-through via the actual #/train route proving a Soldier can find and
 * launch one of these through the real UI.
 *
 * Every ending is asserted by a regex on ITS OWN outcome text AND a negative
 * check against the integrated ending's text - proving four genuinely
 * different outcomes, not one outcome reached four ways. The integrated
 * path also verifies the real store.recordAttempt() row carries the exact
 * expected per-dimension score.
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

// One table drives everything: the four choice-text anchors, the four
// distinct outcome anchors, and the exact integrated-path score. Adding a
// fourth IOT scenario later means adding one row here, nothing else.
const SCENARIOS = [
  {
    id: "sc-iot-comms-blackout", title: "Comms Blackout on the Objective", searchTerm: "Comms Blackout",
    doctrineRef: "ADP 6-0",
    choices: { rigid: "Keep hammering the same frequency", reckless: "Forget the commo plan entirely", passive: "Stop and wait in place", integrated: "Work the next rung of the PACE plan" },
    endings: { rigid: /sat still for forty minutes/i, reckless: /assuming you'd been overrun/i, passive: /waited for permission you didn't need/i, integrated: /one word: 'Good\.'/i },
    integratedScore: { Leads: 3, Intellect: 3, Achieves: 2 },
  },
  {
    id: "sc-iot-motorpool-belt", title: "Cracked Belt, Thirty Minutes to Convoy", searchTerm: "Cracked Belt",
    doctrineRef: "DA PAM 750-8",
    choices: { rigid: "Deadline it exactly per the TM", reckless: "It's a crack, not a break", passive: "Don't deadline it, don't roll", integrated: "Deadline the vehicle per the standard" },
    endings: { rigid: /where the fifth truck was/i, reckless: /belt let go forty minutes down the MSR/i, passive: /spent them all on waiting/i, integrated: /swapped the belt in twenty minutes/i },
    integratedScore: { Leads: 3, Intellect: 2, Achieves: 3, Character: 1 },
  },
  {
    id: "sc-iot-range-safety", title: "Range Fan Violation, First Relay Loaded", searchTerm: "Range Fan",
    doctrineRef: "AR 385-63",
    choices: { rigid: "Start the relay on the published schedule", reckless: "Send one Soldier running", passive: "^Freeze\\.", integrated: "Halt the relay immediately" },
    endings: { rigid: /commanded live fire into an impact area/i, reckless: /most dangerous decision anyone made/i, passive: /range with no OIC/i, integrated: /confirmed clear in eleven minutes/i },
    integratedScore: { Leads: 3, Intellect: 2, Achieves: 2, Character: 2 },
  },
];

// ---- ground truth + G.author's own validator, all three at once ----
{
  const { page, noise } = await newPage();
  const truths = await page.evaluate((ids) => ids.map((id) => {
    const sc = window.G.store.scenario(id);
    if (!sc) return { id, found: false };
    const v = window.G.author && window.G.author.validate ? window.G.author.validate(sc) : null;
    const n2 = sc.nodes.n2;
    return {
      id, found: true, doctrineRef: sc.doctrine && sc.doctrine[0] && sc.doctrine[0].pub,
      competency: sc.competency, nodeCount: Object.keys(sc.nodes).length, choiceCount: n2 ? n2.choices.length : 0,
      distinctEnds: n2 ? new Set(n2.choices.map((c) => c.goto)).size : 0, validate: v,
    };
  }), SCENARIOS.map((s) => s.id));
  for (const s of SCENARIOS) {
    const t = truths.find((x) => x.id === s.id);
    t && t.found ? ok(`seed ground truth: found "${s.id}"`) : bad(`${s.id} not found in GUIDON_SEED.scenarios.scenarios`);
    if (!t || !t.found) continue;
    t.doctrineRef === s.doctrineRef ? ok(`${s.id} cites ${s.doctrineRef} as its primary doctrine reference`) : bad(`${s.id} doctrine ref: ${t.doctrineRef}, expected ${s.doctrineRef}`);
    (t.validate && t.validate.ok === true && (t.validate.errors || []).length === 0)
      ? ok(`${s.id}: G.author.validate() reports zero structural issues`)
      : bad(`${s.id}: G.author.validate() found issues: ` + JSON.stringify(t.validate));
    (t.nodeCount === 6 && t.choiceCount === 4 && t.distinctEnds === 4)
      ? ok(`${s.id}: 6 nodes, a 4-way decision node, 4 DISTINCT end targets (real branching, not a shared ending)`)
      : bad(`${s.id}: shape mismatch - nodes:${t.nodeCount} choices:${t.choiceCount} distinctEnds:${t.distinctEnds}`);
    JSON.stringify(t.competency) === JSON.stringify(["Leads", "Intellect", "Achieves"])
      ? ok(`${s.id}: competency is the IOT triad (Leads / Intellect / Achieves)`)
      : bad(`${s.id}: competency ${JSON.stringify(t.competency)}`);
  }
  noise.length === 0 ? ok("no console noise loading the seed") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

// ---- helpers for driving a detached G.engine.run() session ----
async function boot(page, id) {
  await page.evaluate((id) => {
    document.querySelectorAll("#iot-test-host").forEach((n) => n.remove());
    const d = document.createElement("div");
    d.id = "iot-test-host";
    document.body.appendChild(d);
    window.G.engine.run(id, "cyoa", d, null);
  }, id);
  await page.waitForTimeout(250);
}
async function clickChoice(page, textPattern) {
  const found = await page.evaluate((p) => {
    const btns = Array.from(document.querySelectorAll("#iot-test-host button"));
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
    const btns = Array.from(document.querySelectorAll("#iot-test-host button"));
    const c = btns.find((b) => /Continue/i.test(b.textContent || "") && !b.disabled);
    if (c) c.click();
  });
  await page.waitForTimeout(150);
}
const hostText = (page) => page.evaluate(() => document.querySelector("#iot-test-host")?.textContent || "");
const attemptsFor = (page, id) => page.evaluate(async (id) => (await window.G.db.allAttempts()).filter((a) => a.scenarioId === id), id);

// Play one path: n1 (Continue) -> n2 (the named choice) -> its end node.
async function playPath(page, s, kind) {
  await boot(page, s.id);
  const c1 = await clickChoice(page, "^Continue$"); await clickAdvance(page);
  const c2 = await clickChoice(page, s.choices[kind]); await clickAdvance(page);
  return { c1, c2, text: await hostText(page) };
}

// ---- every ending, every scenario: 4 x 3 = 12 playthroughs ----
for (const s of SCENARIOS) {
  for (const kind of ["rigid", "reckless", "passive", "integrated"]) {
    const { page, noise } = await newPage();
    const r = await playPath(page, s, kind);
    r.c1 ? ok(`${s.id} [${kind}]: n1 situation node offers Continue`) : bad(`${s.id} [${kind}]: n1 Continue missing`);
    r.c2 ? ok(`${s.id} [${kind}]: the ${kind} choice is offered on the decision node`) : bad(`${s.id} [${kind}]: choice not found: ${s.choices[kind]}`);
    s.endings[kind].test(r.text)
      ? ok(`${s.id} [${kind}]: reached its own distinct "${kind}" ending`)
      : bad(`${s.id} [${kind}]: wrong ending reached: ` + r.text.slice(-300));
    if (kind !== "integrated") {
      !s.endings.integrated.test(r.text)
        ? ok(`${s.id} [${kind}]: ending is genuinely distinct from the integrated ending (real branching, not one text reached four ways)`)
        : bad(`${s.id} [${kind}]: incorrectly shows the integrated ending text`);
    } else {
      const attempts = await attemptsFor(page, s.id);
      const got = attempts[0] && attempts[0].score;
      const expected = s.integratedScore;
      const match = attempts.length === 1 && got && Object.keys(expected).every((k) => got[k] === expected[k])
        && Object.keys(got).filter((k) => got[k] !== 0).every((k) => k in expected);
      match
        ? ok(`${s.id} [integrated]: real store.recordAttempt() row written with the exact expected score ${JSON.stringify(expected)}`)
        : bad(`${s.id} [integrated]: attempt row missing or score mismatch: ` + JSON.stringify(attempts));
    }
    noise.length === 0 ? ok(`${s.id} [${kind}]: no console noise`) : bad(`${s.id} [${kind}]: console noise: ` + noise.join(" | "));
    await page.close();
  }
}

// ---- Real end-to-end reachability via the actual #/train route ----
{
  const s = SCENARIOS[0];
  const { page, noise } = await newPage();
  await page.evaluate(() => { location.hash = "#/train"; });
  await page.waitForTimeout(600);
  const search = page.locator('input[placeholder*="Search"]').first();
  await search.fill(s.searchTerm);
  await page.waitForTimeout(300);
  const cardVisible = await page.evaluate((title) => {
    const cards = Array.from(document.querySelectorAll(".grid .card.click"));
    return cards.some((c) => (c.textContent || "").includes(title));
  }, s.title);
  cardVisible ? ok(`a real Soldier searching "${s.searchTerm}" on #/train finds the scenario card`) : bad(`scenario card not found via #/train search for "${s.searchTerm}"`);
  if (cardVisible) {
    await page.locator(".grid .card.click", { hasText: s.title }).first().click();
    await page.waitForTimeout(400);
    const launched = await page.evaluate(() => /COMMS BLACKOUT/i.test(document.body.textContent || ""));
    launched ? ok("clicking the real card launches the scenario through the real Train UI") : bad("clicking the card did not launch the scenario");
  }
  noise.length === 0 ? ok("no console noise navigating #/train and launching via the real UI") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

console.log(fails === 0 ? "\nIOT SCENARIOS: all passed" : `\nIOT SCENARIOS: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
