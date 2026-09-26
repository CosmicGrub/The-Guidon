/**
 * Collective Decision as a native G.engine mode (ROADMAP 3g item H, the last
 * open piece): routing, discussion gate, exit contract, planted defects.
 *
 * WHY THIS SUITE EXISTS. Collective Decision (a team discusses, then commits
 * one answer per decision) used to be a wrapper: 00-roadmap-bootstrap.js
 * replaced the public G.engine.run at load and ran its own screens. It is now
 * a mode of the core engine (src/index.html, the COLLECTIVE section of the
 * engine module). Deleting this file would let the following ship unnoticed:
 *   - a module quietly wrapping G.engine.run / G.engine.runCollective again,
 *     so two owners of one public API fight over load order;
 *   - a scenario with a `discuss` step opening the solo player (or an ordinary
 *     scenario opening the discussion gate), or a missing scenario failing
 *     silently;
 *   - the discussion gate leaking: choices selectable before the team has
 *     discussed, the timer clamped wrong, a screen that is gone still ticking,
 *     the a11y roles / labels / live regions / focus handoffs dropped;
 *   - the completion contract - onExit({completed, cancelled, scenarioId}) -
 *     firing twice, or telling a caller the team CANCELLED after it finished;
 *   - the attempt row (mode "collective") or the scoring rules changing, or a
 *     collective run writing any storage other than that one attempt.
 *
 * PLANTED DEFECTS. The static half runs its detector over planted wrapper
 * text and must catch it (and must NOT fire on a comment or a comparison), so
 * a detector that went blind is itself a failure. The behavioural half was
 * also run once against the pre-refactor build (the wrapper, commit c28fe8f)
 * to prove it can fail: it went red in exactly the places the refactor
 * deliberately changed - the wrapper checks in section 1 and the static half,
 * the null-node routing check, and the three exit-contract checks (a session
 * tells its caller once; the header Exit on a finished collective AAR says
 * completed, not cancelled) - and stayed green on every screen, accessibility,
 * timer, scoring, attempt-row and storage assertion, i.e. on everything a
 * Soldier sees. (A second, throwaway harness walked all 201 visible scenarios
 * forced collective two ways plus the Team Training relays through both builds
 * and diffed every step's markup: identical.)
 *
 * Timers: the discussion gate ticks once a second and never lasts less than
 * 10 s. This suite makes the ONE interval that screen starts run at 4 ms (a
 * flag set only for the launching call) so the timer can expire for real;
 * the gate's own logic is untouched and every wait below is on state.
 */
import { readFileSync } from "node:fs";
import { bootApp, check, finish, until, clickWhenStable, waitForRoute, expectNoConsoleNoise } from "./testkit.mjs";
import { blankSource } from "./module-contract.mjs";

/* =====================================================================
   Static half (no browser): nothing outside the core engine replaces the
   public engine entry points.
   ===================================================================== */
const replacesEngineEntry = (src) => /(?:window\.)?G\.engine\.(?:run|runCollective|_soloRun)\s*=(?!=)/.test(blankSource(src).code);

const PLANTED_WRAPPER = [
  "(function () {",
  "  var original = G.engine.run.bind(G.engine);",
  "  G.engine.run = function (id, mode, container, onExit, options) { return original(id, mode, container, onExit); };",
  "})();",
].join("\n");
check(replacesEngineEntry(PLANTED_WRAPPER), "planted defect caught: a module that captures and replaces G.engine.run is detected", "the wrapper detector missed a planted G.engine.run replacement");
check(replacesEngineEntry("window.G.engine.runCollective = function () {};"), "planted defect caught: assigning G.engine.runCollective from a module is detected", "the wrapper detector missed a planted G.engine.runCollective assignment");
check(!replacesEngineEntry("// G.engine.run = old wrapper\n/* G.engine.runCollective = x */ if (G.engine.run === undefined || G.engine.run == null) {}"),
  "...and the detector stays quiet for a comment, a === and a == (no false alarm)", "the wrapper detector fired on a comment or a comparison");

const bootstrapSrc = readFileSync(new URL("../src/app-modules/00-roadmap-bootstrap.js", import.meta.url), "utf8");
check(!replacesEngineEntry(bootstrapSrc), "00-roadmap-bootstrap.js no longer replaces G.engine.run or G.engine.runCollective", "00-roadmap-bootstrap.js assigns a public engine entry point again - Collective mode belongs to the core engine");
check(!/_soloRun|runCollective/.test(blankSource(bootstrapSrc).code), "00-roadmap-bootstrap.js carries no collective runner and no captured original", "00-roadmap-bootstrap.js still mentions runCollective / _soloRun in code");
const manifest = JSON.parse(readFileSync(new URL("../src/app-modules/manifest.json", import.meta.url), "utf8"));
check(!manifest.modules.some((m) => (m.patches || []).some((p) => p.name === "G.engine.run")), "manifest.json declares no patch of G.engine.run", "manifest.json still declares a patch of G.engine.run");
check(!manifest.modules.some((m) => m.provides.includes("G.engine.runCollective")), "manifest.json lists no module as the provider of G.engine.runCollective (core defines it)", "a module still claims to provide G.engine.runCollective");

/* =====================================================================
   Running app
   ===================================================================== */
const boot = await bootApp({ viewport: { width: 1000, height: 900 } });
const { page, noise } = boot;
// Home and Progress redraw themselves (and move focus to their heading) whenever an attempt is logged, which
// would pull focus out of a screen this suite is measuring. Work from a screen that does not.
await waitForRoute(page, "#/settings", { ready: "#route h1, #route h2" });

await page.evaluate(() => {
  // Instrumentation for the timer only (see the header). The interval that a
  // discussion gate starts while __ecFast is set runs at 4 ms instead of
  // 1000; every id it starts and every id anyone clears is recorded.
  window.__ecFast = false;
  window.__ecTimers = { started: [], cleared: [] };
  const realSet = window.setInterval.bind(window), realClear = window.clearInterval.bind(window);
  window.setInterval = function (fn, ms) {
    const rest = Array.prototype.slice.call(arguments, 2);
    const id = realSet.apply(null, [fn, window.__ecFast && ms === 1000 ? 4 : ms].concat(rest));
    if (window.__ecFast) window.__ecTimers.started.push(id);
    return id;
  };
  window.clearInterval = function (id) { window.__ecTimers.cleared.push(id); return realClear(id); };
});

/* ---- fixtures ---- */
const FULL = {
  id: "qa-engine-collective-full", title: "QA Collective Full", scene: "QA RANGE 4", tier: ["E4"], competency: ["Leads"], difficulty: "Basic",
  defaultMode: "cyoa", renderModes: ["cyoa"], start: "n1",
  nodes: {
    n1: {
      beat: "DECISION ONE", prompt: "Pick the team answer.", discussionSeconds: 20,
      dialogue: [{ speaker: "SSG Reyes", line: "Talk it through first." }, null, "junk"],
      choices: [
        { text: "Alpha", goto: "n2", score: { Leads: 2, Bravo: 3 }, set: { flagA: true }, feedback: "Alpha feedback.", tradeoff: "Alpha costs time." },
        { text: "Beta", goto: "n2", score: { Leads: 1 } },
        { text: "Gamma", goto: "n2", score: { Intellect: 1 }, showIf: "neverSet" },
      ],
    },
    n2: {
      prompt: "Only one option remains.",
      choices: [
        { text: "Alpha follow-up", showIf: "flagA", goto: "n3", score: { Achieves: 1 } },
        { text: "Beta follow-up", showIf: { not: "flagA" }, goto: "n3" },
      ],
    },
    n3: { prompt: "Auto continue.", next: "n4" },
    n4: { prompt: "Last step.", choices: [{ text: "Finish", outcome: "done" }] },
    done: { end: true, outcome: "All done." },
  },
};
const mini = (id, nodes, extra) => Object.assign({ id, title: "QA " + id, tier: ["E4"], competency: ["Leads"], difficulty: "Basic", defaultMode: "cyoa", renderModes: ["cyoa"], start: "n1", nodes }, extra || {});
const TWO_WAY = (id, extra, nodeExtra) => mini(id, {
  n1: Object.assign({ prompt: "Decide.", choices: [{ text: "Yes", goto: "end" }, { text: "No", goto: "end" }] }, nodeExtra || {}),
  end: { end: true, outcome: "Ended." },
}, extra);
const ONE_WAY = (id) => mini(id, { n1: { prompt: "One step.", choices: [{ text: "Go", goto: "end", score: { Leads: 1 } }] }, end: { end: true, outcome: "Ended." } });

/* ---- helpers ---- */
async function launch(spec) {
  return page.evaluate((spec) => {
    const old = document.getElementById("ec-host"); if (old) old.remove();
    const host = document.createElement("div"); host.id = "ec-host"; document.body.appendChild(host);
    window.__ecCalls = []; window.__ecToasts = []; window.__ecThrew = null; window.__ecStartedIds = [];
    const G = window.G, store = G.store, util = G.util;
    const onExit = spec.noExit ? null : (r) => window.__ecCalls.push(r);
    const realToast = util.toast, realScenario = store.scenario;
    util.toast = function (m) { window.__ecToasts.push(String(m)); };
    if (spec.lend) store.scenario = function (id) { return id === spec.lend.id ? spec.lend : realScenario.apply(store, arguments); };
    const before = window.__ecTimers.started.length;
    window.__ecFast = !!spec.fastTimer;
    try {
      if (spec.via === "runCollective") G.engine.runCollective(spec.fixture || spec.id, host, onExit, spec.options);
      else G.engine.run(spec.id || spec.lend.id, spec.mode === undefined ? null : spec.mode, host, onExit, spec.options);
    } catch (e) { window.__ecThrew = String(e && e.message || e); }
    finally { window.__ecFast = false; util.toast = realToast; store.scenario = realScenario; }
    window.__ecStartedIds = window.__ecTimers.started.slice(before);
    return { threw: window.__ecThrew };
  }, spec);
}
const host = page.locator("#ec-host");
const hostBtn = (re) => host.locator("button", { hasText: re });
const calls = () => page.evaluate(() => window.__ecCalls);
const hostText = () => page.evaluate(() => (document.getElementById("ec-host") || { textContent: "" }).textContent.replace(/\s+/g, " ").trim());
const active = () => page.evaluate(() => (document.activeElement && document.activeElement.textContent || "").trim());
const attempts = () => page.evaluate(async () => (await window.G.db.allAttempts()) || []);
const kvKeys = () => page.evaluate(async () => (await window.G.db.all("kv")).map((r) => r.k).sort());
const timerText = () => page.evaluate(() => { const t = document.querySelector("#ec-host [data-collective-timer]"); return t ? t.textContent : null; });
const click = (re) => clickWhenStable(page, hostBtn(re));
const waitAar = () => until(page, () => !!document.querySelector("#ec-host .collective-outcome"));
const has = (sel) => page.evaluate((s) => !!document.querySelector("#ec-host " + s), sel);
const J = (v) => JSON.stringify(v);

/* =====================================================================
   1. Native, not a wrapper
   ===================================================================== */
{
  const facts = await page.evaluate(() => {
    const src = String(window.G.engine.run);
    const owner = [...document.scripts].find((s) => !s.src && s.textContent.indexOf(src) >= 0);
    return {
      run: typeof G.engine.run, runCollective: typeof G.engine.runCollective, soloRun: typeof G.engine._soloRun,
      ownedByEngineModule: !!owner && owner.textContent.indexOf("/* ==== js/engine.js ==== */") >= 0,
    };
  });
  check(facts.run === "function" && facts.runCollective === "function", "G.engine.run and G.engine.runCollective are both functions in the running app", () => "engine surface: " + J(facts));
  check(facts.soloRun === "undefined", "there is no captured G.engine._soloRun original any more", () => "G.engine._soloRun is " + facts.soloRun);
  check(facts.ownedByEngineModule, "G.engine.run's source lives in the core engine module (src/index.html), not in a module script", () => "the running G.engine.run was not found in the engine module's script: " + J(facts));
}

/* =====================================================================
   2. Routing: who runs collectively, who runs solo, what a missing id does
   ===================================================================== */
{
  const started = await launch({ id: "sc-collective-decision-relay", mode: "course" });
  await until(page, () => !!document.querySelector("#ec-host .collective-decision"));
  const relay = await page.evaluate(() => ({
    decision: !!document.querySelector("#ec-host .collective-decision"),
    eyebrow: (document.querySelector("#ec-host .engine-head .eyebrow") || {}).textContent,
    segmented: !!document.querySelector("#ec-host .segmented"),
  }));
  check(!started.threw && relay.decision && relay.eyebrow === "Collective scenario" && !relay.segmented,
    "a real scenario whose nodes carry a `discuss` step runs collectively through plain G.engine.run(id, mode, host, onExit) - no options needed, and no solo mode switch",
    () => "relay routing: " + J({ started, relay }));
}
{
  await launch({ id: "sc-train-opsec", mode: "training" });
  await until(page, () => !!document.querySelector("#ec-host .engine-head"));
  const solo = await page.evaluate(() => ({
    segmented: !!document.querySelector("#ec-host .segmented"),
    decision: !!document.querySelector("#ec-host .collective-decision"),
    eyebrow: (document.querySelector("#ec-host .engine-head .eyebrow") || {}).textContent,
  }));
  check(solo.segmented && !solo.decision && solo.eyebrow !== "Collective scenario", "an ordinary scenario (no `discuss` step, no option) still opens the solo player", () => "solo routing: " + J(solo));
  await click(/^\s*Exit\s*$/);   // the solo header's Exit carries an icon, so its text has a leading space
  const soloCalls = await calls();
  check(soloCalls.length === 1 && soloCalls[0].completed === false && soloCalls[0].cancelled === true && soloCalls[0].scenarioId === "sc-train-opsec",
    "the solo path keeps its v1.15.3 contract: header Exit mid-play reports cancelled, once", () => "solo exit calls: " + J(soloCalls));

  await launch({ id: "sc-train-opsec", mode: "training", options: { collective: true } });
  await until(page, () => !!document.querySelector("#ec-host .engine-head"));
  const forced = await page.evaluate(() => ({
    eyebrow: (document.querySelector("#ec-host .engine-head .eyebrow") || {}).textContent,
    segmented: !!document.querySelector("#ec-host .segmented"),
  }));
  check(forced.eyebrow === "Collective scenario" && !forced.segmented, "options.collective forces any scenario onto the collective screens", () => "forced routing: " + J(forced));
}
{
  // The Board Simulator's technique: lend the engine a scenario for the one synchronous lookup at the top of run().
  const deep = mini("qa-engine-collective-deep-discuss", {
    n1: { prompt: "Warm-up.", choices: [{ text: "On", goto: "n2" }] },
    n2: { prompt: "Team call.", discuss: true, choices: [{ text: "Left", goto: "end" }, { text: "Right", goto: "end" }] },
    end: { end: true, outcome: "Ended." },
  });
  await launch({ lend: deep, mode: "cyoa" });
  const deepRoute = await page.evaluate(() => ({ collective: (document.querySelector("#ec-host .engine-head .eyebrow") || {}).textContent === "Collective scenario" }));
  check(deepRoute.collective, "a `discuss` step on any node (not just the first) routes the whole scenario to collective mode", () => "deep discuss routing: " + J(deepRoute));

  const plain = mini("qa-engine-collective-plain", { n1: { prompt: "Plain.", choices: [{ text: "Go", goto: "end" }] }, end: { end: true, outcome: "Ended." } });
  await launch({ lend: plain, mode: "cyoa" });
  const plainRoute = await page.evaluate(() => ({ collective: (document.querySelector("#ec-host .engine-head .eyebrow") || {}).textContent === "Collective scenario", segmented: !!document.querySelector("#ec-host .segmented") }));
  check(!plainRoute.collective && plainRoute.segmented, "the same shape of scenario without a `discuss` step stays solo", () => "plain routing: " + J(plainRoute));

  const holey = mini("qa-engine-collective-null-node", { n1: { prompt: "Plain.", choices: [{ text: "Go", goto: "end" }] }, end: { end: true, outcome: "Ended." }, broken: null });
  const res = await launch({ lend: holey, mode: "cyoa" });
  check(!res.threw, "a scenario carrying a null node still starts (routing never throws on authored data)", () => "run() threw: " + res.threw);
}
{
  const gone = await launch({ id: "qa-no-such-scenario", mode: "course" });
  const goneState = await page.evaluate(() => ({ toasts: window.__ecToasts, empty: document.getElementById("ec-host").childElementCount === 0, calls: window.__ecCalls }));
  check(!gone.threw && goneState.toasts.length === 1 && goneState.toasts[0] === "Scenario not found." && goneState.empty && goneState.calls.length === 0,
    "G.engine.run with an unknown id says \"Scenario not found.\", draws nothing and never calls onExit", () => "missing id via run: " + J({ gone, goneState }));
  const gone2 = await launch({ via: "runCollective", id: "qa-no-such-scenario" });
  const gone2State = await page.evaluate(() => ({ toasts: window.__ecToasts, empty: document.getElementById("ec-host").childElementCount === 0, calls: window.__ecCalls }));
  check(!gone2.threw && gone2State.toasts.length === 1 && gone2State.toasts[0] === "Scenario not found." && gone2State.empty && gone2State.calls.length === 0,
    "G.engine.runCollective with an unknown id behaves the same way", () => "missing id via runCollective: " + J({ gone2, gone2State }));
  const byId = await launch({ via: "runCollective", id: "sc-collective-decision-relay" });
  await until(page, () => !!document.querySelector("#ec-host .collective-decision"));
  check(!byId.threw && await has(".collective-decision"), "G.engine.runCollective accepts a stored scenario id", "runCollective(id) did not draw the decision screen");
}

/* =====================================================================
   3. The screens of one full run (FULL fixture, by scenario object)
   ===================================================================== */
const kvBefore = await kvKeys();
const attemptsBefore = (await attempts()).length;
await launch({ via: "runCollective", fixture: FULL, options: { discussionSeconds: 45 } });
await until(page, () => !!document.querySelector("#ec-host .collective-decision"));
{
  const s = await page.evaluate(() => {
    const q = (sel) => document.querySelector("#ec-host " + sel);
    const region = q(".collective-decision");
    const group = q("[role=group]");
    const choices = [...document.querySelectorAll("#ec-host .collective-choice")];
    const commit = [...document.querySelectorAll("#ec-host button")].find((b) => /^Commit team answer$/.test(b.textContent));
    return {
      eyebrow: (q(".engine-head .eyebrow") || {}).textContent, title: (q(".engine-head h2") || {}).textContent, scene: (q(".engine-head .engine-scene-tag") || {}).textContent,
      regionRole: region.getAttribute("role"), regionLabel: region.getAttribute("aria-label"), regionEyebrow: (region.querySelector(".eyebrow") || {}).textContent,
      beat: (region.querySelector(".engine-scene-tag") || {}).textContent, prompt: (region.querySelector("h3") || {}).textContent,
      dialogue: [...region.querySelectorAll(".card")].map((c) => c.textContent),
      timer: (q("[data-collective-timer]") || {}).textContent, timerLabel: (q("[data-collective-timer]") || {}).getAttribute("aria-label"),
      status: (q("p.hint[role=status]") || {}).textContent, statusLive: (q("p.hint[role=status]") || {}).getAttribute("aria-live"),
      groupLabel: group && group.getAttribute("aria-label"),
      choices: choices.map((b) => ({ text: b.textContent, disabled: b.disabled, pressed: b.getAttribute("aria-pressed"), type: b.getAttribute("type") })),
      commitDisabled: commit && commit.disabled, focus: document.activeElement && document.activeElement.textContent,
      exitButtons: [...document.querySelectorAll("#ec-host .engine-head button")].map((b) => b.textContent),
    };
  });
  check(s.eyebrow === "Collective scenario" && s.title === "QA Collective Full" && s.scene === "QA RANGE 4" && J(s.exitButtons) === '["Exit"]',
    "the header shows the Collective scenario eyebrow, the title, the scene tag and one Exit button", () => "header: " + J(s));
  check(s.regionRole === "region" && s.regionLabel === "Collective Decision" && s.regionEyebrow === "Collective Decision" && s.beat === "DECISION ONE" && s.prompt === "Pick the team answer.",
    "a multi-choice node is a labelled \"Collective Decision\" region with its beat and prompt", () => "region: " + J(s));
  check(s.dialogue.length === 1 && s.dialogue[0] === "SSG ReyesTalk it through first.",
    "dialogue lines render as cards (speaker, then line); members that are not objects are skipped", () => "dialogue: " + J(s.dialogue));
  check(s.timer === "Discussion: 20s" && s.timerLabel === "Discussion time remaining",
    "the node's own discussionSeconds (20) beats the caller's option (45), and the timer is labelled", () => "timer: " + J({ t: s.timer, l: s.timerLabel }));
  check(s.status === "Discuss first. Lock the discussion early when the team is ready." && s.statusLive === "polite" && s.groupLabel === "Team decision choices",
    "the discussion prompt is a polite live region and the choices sit in a labelled group", () => "status/group: " + J(s));
  check(J(s.choices.map((c) => c.text)) === '["A. Alpha","B. Beta"]' && s.choices.every((c) => c.disabled && c.pressed === "false" && c.type === "button"),
    "choices are lettered over the VISIBLE ones only (a showIf-hidden choice takes no letter) and are locked, unpressed buttons", () => "choices: " + J(s.choices));
  check(s.commitDisabled === true && s.focus === "Lock decision early", "Commit team answer starts disabled and focus lands on Lock decision early", () => "commit/focus: " + J({ c: s.commitDisabled, f: s.focus }));
}
{
  await click(/^Lock decision early$/);
  const unlocked = await page.evaluate(() => ({
    status: document.querySelector("#ec-host p.hint[role=status]").textContent,
    enabled: [...document.querySelectorAll("#ec-host .collective-choice")].every((b) => !b.disabled),
    commitDisabled: [...document.querySelectorAll("#ec-host button")].find((b) => /^Commit team answer$/.test(b.textContent)).disabled,
  }));
  check(unlocked.status === "Discussion locked early. Select the team's answer." && unlocked.enabled && unlocked.commitDisabled,
    "Lock decision early unlocks the choices with a status message and still needs a selection before Commit", () => "after lock: " + J(unlocked));

  await click(/^B\. Beta$/);
  await click(/^A\. Alpha$/);
  const picked = await page.evaluate(() => ({
    pressed: [...document.querySelectorAll("#ec-host .collective-choice")].map((b) => b.getAttribute("aria-pressed") + ":" + b.classList.contains("active")),
    status: document.querySelector("#ec-host p.hint[role=status]").textContent,
    commitDisabled: [...document.querySelectorAll("#ec-host button")].find((b) => /^Commit team answer$/.test(b.textContent)).disabled,
  }));
  check(J(picked.pressed) === '["true:true","false:false"]' && picked.status === "Team choice selected. Commit when everyone is ready." && picked.commitDisabled === false,
    "selecting a choice toggles aria-pressed / active (one at a time), says so, and enables Commit", () => "after select: " + J(picked));

  await click(/^Commit team answer$/);
  const committed = await page.evaluate(() => ({
    choicesDisabled: [...document.querySelectorAll("#ec-host .collective-choice")].every((b) => b.disabled),
    earlyDisabled: [...document.querySelectorAll("#ec-host button")].find((b) => /^Lock decision early$/.test(b.textContent)).disabled,
    commit: [...document.querySelectorAll("#ec-host button")].find((b) => /^Team answer committed$/.test(b.textContent)) ? "relabelled" : "not relabelled",
    feedback: (() => { const f = document.querySelector("#ec-host .feedback"); return f ? f.getAttribute("role") + "|" + f.getAttribute("aria-live") + "|" + f.textContent : null; })(),
    tradeoff: [...document.querySelectorAll("#ec-host p.hint")].map((p) => p.textContent).filter((t) => /^Tradeoff/.test(t)),
    focus: document.activeElement && document.activeElement.textContent,
  }));
  check(committed.choicesDisabled && committed.earlyDisabled && committed.commit === "relabelled",
    "Commit team answer locks every choice and the lock-early button and relabels itself \"Team answer committed\"", () => "after commit: " + J(committed));
  check(committed.feedback === "status|polite|Alpha feedback." && J(committed.tradeoff) === '["Tradeoff: Alpha costs time."]' && committed.focus === "Continue",
    "the committed choice's feedback is a polite status, its tradeoff is shown, and focus moves to Continue", () => "feedback/tradeoff/focus: " + J(committed));

  await click(/^Continue$/);
  const single = await page.evaluate(() => ({
    decision: !!document.querySelector("#ec-host .collective-decision"),
    text: document.getElementById("ec-host").textContent.replace(/\s+/g, " "),
    buttons: [...document.querySelectorAll("#ec-host .panel button")].map((b) => b.textContent),
    focus: document.activeElement && document.activeElement.textContent,
  }));
  check(!single.decision && /Only one option remains\./.test(single.text) && J(single.buttons) === '["Alpha follow-up"]' && single.focus === "Alpha follow-up",
    "the flag the first choice set (flagA) gates the next node's choices: one visible choice is a plain step, not a discussion, and takes focus", () => "n2: " + J(single));
}
{
  await click(/^Alpha follow-up$/);
  const auto = await page.evaluate(() => ({ text: document.getElementById("ec-host").textContent.replace(/\s+/g, " "), buttons: [...document.querySelectorAll("#ec-host .panel button")].map((b) => b.textContent) }));
  check(/Auto continue\./.test(auto.text) && J(auto.buttons) === '["Continue"]', "a node with only `next` becomes a single Continue step", () => "n3: " + J(auto));
  await click(/^Continue$/);
  const outcomeTarget = await page.evaluate(() => [...document.querySelectorAll("#ec-host .panel button")].map((b) => b.textContent));
  check(J(outcomeTarget) === '["Finish"]', "the next node shows its one choice", () => "n4: " + J(outcomeTarget));
  await click(/^Finish$/);
  await waitAar();
  const aar = await page.evaluate(() => ({
    eyebrow: (document.querySelector("#ec-host .collective-outcome .eyebrow") || {}).textContent,
    h3: (document.querySelector("#ec-host .collective-outcome h3") || {}).textContent,
    paras: [...document.querySelectorAll("#ec-host .collective-outcome p")].map((p) => p.textContent),
    buttons: [...document.querySelectorAll("#ec-host .collective-outcome button")].map((b) => b.textContent),
    head: !!document.querySelector("#ec-host .engine-head"),
  }));
  check(aar.eyebrow === "Collective AAR" && aar.h3 === "Scenario complete" && aar.paras[0] === "All done." && aar.head && J(aar.buttons) === '["Replay collective lane","Done"]',
    "a choice that names its target in `outcome` reaches the end node, and the AAR panel has its title, the outcome text, the header and Replay / Done", () => "AAR: " + J(aar));
  check(aar.paras[1] === "Team score: 6 · 4 decisions. The score is a study signal, not an official evaluation.",
    "the AAR reports the team score (sum of every dimension a choice scored, including one outside the six) and the decision count", () => "AAR score line: " + J(aar.paras));
}
{
  const rows = await attempts();
  const mine = rows.filter((r) => r.scenarioId === "qa-engine-collective-full");
  const row = mine[0] || {};
  const dims = ["Leads", "Develops", "Achieves", "Character", "Presence", "Intellect"];
  check(mine.length === 1 && rows.length === attemptsBefore + 1, "exactly one attempt was recorded for the run", () => "attempt rows: " + J({ mine: mine.length, total: rows.length, before: attemptsBefore }));
  check(row.mode === "collective" && row.title === "QA Collective Full" && row.total === 6 && row.choices === 4 && row.outcomeNode === "done",
    "the attempt row carries mode \"collective\", the title, the team total, the decision count and the outcome node", () => "attempt: " + J(row));
  check(row.score && dims.every((d) => typeof row.score[d] === "number") && row.score.Leads === 2 && row.score.Achieves === 1 && row.score.Bravo === 3 && row.score.Develops === 0,
    "the six dimensions all start at 0 and a choice may score a seventh key (collective keeps it; the solo engine ignores it)", () => "attempt score: " + J(row.score));
  const kvAfter = await kvKeys();
  check(J(kvAfter) === J(kvBefore), "a whole collective run writes no on-device rows other than the attempt (the kv key set is unchanged)", () => "kv keys changed: " + J({ before: kvBefore, after: kvAfter }));
}

/* =====================================================================
   4. The discussion timer
   ===================================================================== */
{
  const seen = {};
  const cases = [
    ["option below the floor", TWO_WAY("qa-ec-t-low"), { discussionSeconds: 5 }, "Discussion: 10s"],
    ["option above the ceiling", TWO_WAY("qa-ec-t-high"), { discussionSeconds: 1000 }, "Discussion: 300s"],
    ["option inside the range", TWO_WAY("qa-ec-t-mid"), { discussionSeconds: 45 }, "Discussion: 45s"],
    ["discuss.seconds on the node", TWO_WAY("qa-ec-t-discuss", {}, { discuss: { seconds: 25 } }), { discussionSeconds: 45 }, "Discussion: 25s"],
    ["nothing set", TWO_WAY("qa-ec-t-none"), {}, "Discussion: 60s"],
    ["a value that is not a number", TWO_WAY("qa-ec-t-nan", {}, { discussionSeconds: "abc" }), {}, "Discussion: 60s"],
    ["a fractional value is rounded", TWO_WAY("qa-ec-t-frac"), { discussionSeconds: 30.6 }, "Discussion: 31s"],
  ];
  for (const [name, fixture, options, want] of cases) {
    await launch({ via: "runCollective", fixture, options });
    seen[name] = await timerText();
    check(seen[name] === want, `discussion time: ${name} -> ${want}`, () => `${name}: got ${J(seen[name])}, wanted ${J(want)}`);
  }
}
{
  await launch({ via: "runCollective", fixture: TWO_WAY("qa-ec-t-expire"), options: { discussionSeconds: 10 }, fastTimer: true });
  const startedIds = await page.evaluate(() => window.__ecStartedIds);
  check(startedIds.length === 1, "one decision screen starts exactly one timer", () => "intervals started: " + J(startedIds));
  const reachedZero = await until(page, () => { const t = document.querySelector("#ec-host [data-collective-timer]"); return !!t && t.textContent === "Discussion: 0s"; });
  const expired = await page.evaluate(() => ({
    status: document.querySelector("#ec-host p.hint[role=status]").textContent,
    enabled: [...document.querySelectorAll("#ec-host .collective-choice")].every((b) => !b.disabled),
    cleared: window.__ecTimers.cleared.indexOf(window.__ecStartedIds[0]) >= 0,
  }));
  check(reachedZero && expired.status === "Discussion time complete. Select the team's answer." && expired.enabled && expired.cleared,
    "when the discussion time runs out the choices unlock by themselves, the status says so, and the timer stops", () => "after expiry: " + J({ reachedZero, expired }));

  await launch({ via: "runCollective", fixture: TWO_WAY("qa-ec-t-leak"), options: { discussionSeconds: 300 }, fastTimer: true });
  const leakId = (await page.evaluate(() => window.__ecStartedIds))[0];
  await page.evaluate(() => document.getElementById("ec-host").remove());
  const stopped = await until(page, (id) => window.__ecTimers.cleared.indexOf(id) >= 0, leakId);
  check(stopped, "a decision screen that is removed from the page stops its own timer (nothing keeps ticking behind a closed screen)", () => "interval " + leakId + " was never cleared after the host was removed");

  await launch({ via: "runCollective", fixture: TWO_WAY("qa-ec-t-commit"), options: { discussionSeconds: 300 }, fastTimer: true });
  const commitId = (await page.evaluate(() => window.__ecStartedIds))[0];
  await click(/^Lock decision early$/);
  await click(/^A\. Yes$/);
  await click(/^Commit team answer$/);
  const clearedOnCommit = await page.evaluate((id) => window.__ecTimers.cleared.indexOf(id) >= 0, commitId);
  check(clearedOnCommit, "committing an answer stops the timer at once", () => "interval " + commitId + " was still running after Commit");
}

/* =====================================================================
   5. Completion contract: onExit({completed, cancelled, scenarioId}), once
   ===================================================================== */
{
  // mid-play
  await launch({ via: "runCollective", fixture: FULL });
  await click(/^Exit$/);
  await click(/^Exit$/);
  const midplay = await calls();
  check(midplay.length === 1 && J(midplay[0]) === J({ completed: false, cancelled: true, scenarioId: "qa-engine-collective-full" }),
    "Exit mid-play reports { completed:false, cancelled:true, scenarioId } - and a second click on it says nothing more", () => "mid-play exit calls: " + J(midplay));

  // Done, then the header's Exit
  await launch({ via: "runCollective", fixture: ONE_WAY("qa-ec-exit-done") });
  await click(/^Go$/);
  await waitAar();
  await click(/^Done$/);
  await click(/^Exit$/);
  const doneCalls = await calls();
  check(doneCalls.length === 1 && J(doneCalls[0]) === J({ completed: true, cancelled: false, scenarioId: "qa-ec-exit-done" }),
    "Done on the AAR reports { completed:true, cancelled:false }, and the header Exit that is still on that screen cannot send a second, different answer", () => "Done then Exit calls: " + J(doneCalls));

  // the header Exit alone, on the AAR
  await launch({ via: "runCollective", fixture: ONE_WAY("qa-ec-exit-header") });
  await click(/^Go$/);
  await waitAar();
  await click(/^Exit$/);
  const headerCalls = await calls();
  check(headerCalls.length === 1 && J(headerCalls[0]) === J({ completed: true, cancelled: false, scenarioId: "qa-ec-exit-header" }),
    "the header Exit pressed on the finished AAR reports completed (the screen it is on IS the outcome), not cancelled", () => "AAR header Exit calls: " + J(headerCalls));

  // Replay: a fresh session with a fresh once-only guard
  await launch({ via: "runCollective", fixture: ONE_WAY("qa-ec-replay") });
  await click(/^Go$/);
  await waitAar();
  const firstTotal = (await hostText()).match(/Team score: (\d+) · (\d+) decision/);
  await click(/^Replay collective lane$/);
  const replayScreen = await page.evaluate(() => ({ outcome: !!document.querySelector("#ec-host .collective-outcome"), buttons: [...document.querySelectorAll("#ec-host .panel button")].map((b) => b.textContent) }));
  check(!replayScreen.outcome && J(replayScreen.buttons) === '["Go"]', "Replay collective lane restarts the scenario from its first node", () => "after Replay: " + J(replayScreen));
  await click(/^Go$/);
  await waitAar();
  const secondTotal = (await hostText()).match(/Team score: (\d+) · (\d+) decision/);
  check(firstTotal && secondTotal && firstTotal[1] === secondTotal[1] && firstTotal[2] === secondTotal[2] && secondTotal[1] === "1" && secondTotal[2] === "1",
    "a replay starts from zero: the second run's score and decision count equal the first's, not the two added together", () => "replay totals: " + J({ firstTotal, secondTotal }));
  const replayRows = (await attempts()).filter((r) => r.scenarioId === "qa-ec-replay");
  check(replayRows.length === 2 && replayRows.every((r) => r.mode === "collective" && r.total === 1), "each finished run of a replay is its own attempt row", () => "replay attempts: " + J(replayRows));
  await click(/^Replay collective lane$/);
  await click(/^Exit$/);
  const replayCalls = await calls();
  check(replayCalls.length === 1 && replayCalls[0].cancelled === true && replayCalls[0].completed === false,
    "a replayed session reports on its own: Exit mid-way through the second run is one cancelled result (the first run's session never spoke)", () => "replay exit calls: " + J(replayCalls));

  // no onExit at all
  await launch({ via: "runCollective", fixture: ONE_WAY("qa-ec-noexit"), noExit: true });
  await click(/^Exit$/);
  await launch({ via: "runCollective", fixture: ONE_WAY("qa-ec-noexit2"), noExit: true });
  await click(/^Go$/);
  await waitAar();
  await click(/^Done$/);
  const stillThere = await has(".collective-outcome");
  check(stillThere, "with no onExit callback, Exit and Done do nothing and throw nothing", "the AAR disappeared or errored with no onExit");
}

/* =====================================================================
   6. Broken or odd authored graphs end kindly
   ===================================================================== */
{
  await launch({ via: "runCollective", fixture: mini("qa-ec-g-ghost", { end: { end: true, outcome: "x" } }, { start: "ghost" }) });
  await waitAar();
  const ghost = await hostText();
  check(ghost.includes("This path points to a missing node: ghost."), "a start node that does not exist ends on a plain message naming it", () => "ghost start: " + ghost);

  await launch({ via: "runCollective", fixture: mini("qa-ec-g-nostart", { n1: { prompt: "Default start.", choices: [{ text: "Go", goto: "end" }] }, end: { end: true, outcome: "Ended." } }, { start: undefined }) });
  check(J(await page.evaluate(() => [...document.querySelectorAll("#ec-host .panel button")].map((b) => b.textContent))) === '["Go"]', "a scenario with no `start` begins at n1", "a scenario with no `start` did not begin at n1");

  await launch({ via: "runCollective", fixture: mini("qa-ec-g-nowhere", { n1: { prompt: "Dead end.", choices: [{ text: "Go", outcome: "nope" }] } }) });
  await click(/^Go$/);
  await waitAar();
  const nowhere = await hostText();
  check(nowhere.includes("This authored path has no valid next node. Review the scenario graph."), "a choice whose `outcome` names no node ends the scenario with a plain message", () => "no next node: " + nowhere);

  await launch({ via: "runCollective", fixture: mini("qa-ec-g-bare", { n1: { prompt: "Nothing more to choose here." } }) });
  await waitAar();
  const bare = await hostText();
  check(bare.includes("Nothing more to choose here."), "a node with no choices, no `next` and no `end` finishes with its own prompt", () => "bare node: " + bare);

  await launch({ via: "runCollective", fixture: mini("qa-ec-g-hidden", { n1: { prompt: "Every choice is gated.", choices: [{ text: "Hidden", showIf: "never", goto: "n1" }] } }) });
  await waitAar();
  const hidden = await hostText();
  check(hidden.includes("Every choice is gated."), "a node whose every choice is hidden by its flags finishes instead of hanging", () => "all hidden: " + hidden);

  await launch({ via: "runCollective", fixture: mini("qa-ec-g-nofb", { n1: { prompt: "Feedback-free.", choices: [{ text: "Go", goto: "end" }] }, end: { end: true, prompt: "Prompt fallback." } }) });
  await click(/^Go$/);
  await waitAar();
  const fallback = await hostText();
  check(fallback.includes("Prompt fallback."), "with no outcome text the end node's prompt is the AAR text", () => "prompt fallback: " + fallback);

  await launch({ via: "runCollective", fixture: mini("qa-ec-g-default", { n1: { prompt: "Bare end.", choices: [{ text: "Go", goto: "end" }] }, end: { end: true } }) });
  await click(/^Go$/);
  await waitAar();
  const standing = await hostText();
  check(standing.includes("Review the team's decisions and identify one sustain and one improve."), "an end node with no text falls back to the standing sustain / improve prompt", () => "default text: " + standing);
}

/* =====================================================================
   7. A real scenario end to end, through plain G.engine.run
   ===================================================================== */
{
  const kv0 = await kvKeys();
  const n0 = (await attempts()).length;
  await launch({ id: "sc-collective-decision-relay", mode: "course" });
  await until(page, () => !!document.querySelector("#ec-host .collective-decision"));
  for (let decision = 1; decision <= 3; decision++) {
    await click(/^Lock decision early$/);
    await clickWhenStable(page, host.locator(".collective-choice").first());
    await click(/^Commit team answer$/);
    await click(/^Continue$/);                 // past the committed answer's feedback
    if (decision < 3) await click(/^Continue$/); // past the bridge beat between decisions
  }
  await waitAar();
  const rows = (await attempts()).filter((r) => r.scenarioId === "sc-collective-decision-relay");
  const last = rows[rows.length - 1] || {};
  check((await attempts()).length === n0 + 1 && last.mode === "collective" && last.choices === 5 && last.outcomeNode === "good",
    "the shipped Collective Decision Relay plays through three team decisions to its good ending and logs one collective attempt", () => "relay attempt: " + J(last));
  check(J(await kvKeys()) === J(kv0), "...and writes nothing else to the device", "the relay wrote a kv row");
  await click(/^Done$/);
  const relayCalls = await calls();
  check(relayCalls.length === 1 && relayCalls[0].completed === true && relayCalls[0].scenarioId === "sc-collective-decision-relay", "...and Done reports the relay as completed", () => "relay exit calls: " + J(relayCalls));
}

expectNoConsoleNoise(noise);
await finish("ENGINE COLLECTIVE");
