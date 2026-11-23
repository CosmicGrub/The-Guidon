/**
 * Scenario feedback belongs to its own choice.
 *
 * WHY THIS SUITE EXISTS. The first scenario Home recommends, "sc-late-soldier"
 * (The Chronically Late Soldier), showed the WRONG feedback on two of its three
 * choices: picking "Smoke him in front of the whole platoon..." answered with
 * "Waiting for the DA 4856 to appear is performance management by paperwork",
 * and picking "Say nothing..." answered with "Talking to peers first before
 * addressing the Soldier is a procedural error". The choice texts had been
 * rewritten and the feedback had not (refinement audit 2026-11, GP-01). A
 * Soldier who picks an answer and is told something about a DIFFERENT answer
 * is being taught nonsense, and nothing in the build could see it.
 *
 * THE RULES (mechanical, deliberately cheap; they catch the paste/rewrite slip,
 * not wrong advice - that is a content review). Across the assembled bank
 * (static seed + every content pack, tools/assemble-bank.mjs), for every node
 * with choices that carry `feedback`:
 *   A. OWN WORDS. A feedback must share a content word with its OWN choice's
 *      text. A choice whose text is a STUB (fewer than 3 content words, e.g.
 *      "Continue" or "Ask") may instead share a word with the node it leads to
 *      (that node's beat, prompt, narration and outcome).
 *   B. NOT A BETTER FIT ELSEWHERE. A feedback must not overlap a SIBLING
 *      choice's text clearly more than it overlaps its own (no overlap with its
 *      own, or at least 2 more words than its own).
 *   C. NO SWAP. Within a node, exchanging the feedbacks of any two choices
 *      must not fit the choice texts strictly better than the node's own
 *      pairing (this catches the 2<->3 swap, which rule A alone cannot: each
 *      swapped feedback still "shares a word" with the node's wording).
 * Content words are lower-case, 4+ letters, stop-words dropped (plus words every
 * scenario uses: soldier, leader, army, ...), lightly stemmed ("smoke" matches
 * "smoking").
 *
 * THE RATCHET. When these rules were added, a number of existing choices already
 * failed them (many are fine - good feedback may talk about the principle rather
 * than repeat the choice - and each needs an SME read, a separate content wave).
 * They are frozen in tools/fixtures/scenario-feedback-match-baseline.json as
 * "<scenario id>/<node id>/<choice index>". The suite fails for any choice NOT in
 * that file that violates a rule (a new slip) and for any entry in that file that
 * no longer fails (a stale entry: delete it, so the list only shrinks).
 * Re-freeze deliberately with:  node tools/test-scenario-feedback-match.mjs --rebaseline
 *
 * No browser: this reads the bank through the same assembler every lint uses.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { assembleBank } from "./assemble-bank.mjs";

const BASELINE = fileURLToPath(new URL("./fixtures/scenario-feedback-match-baseline.json", import.meta.url));
const REBASELINE = process.argv.includes("--rebaseline");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const STOP = new Set((
  "about above after again against also because been before being between both cannot could does doing done down during each " +
  "else even ever every from have having here into just like made make many more most much must never only other over same " +
  "should some such than that their them then there these they this those through under until upon very want well were what " +
  "when where which while will with within without would your yours " +
  // words every scenario uses, which say nothing about WHICH choice a feedback answers
  "soldier soldiers leader leaders leadership army unit team squad"
).split(/\s+/));

/** Content words of a string: lower-case, letters only, length >= 4, not a stop-word, lightly stemmed. */
export function contentWords(s) {
  const out = new Set();
  for (let w of String(s || "").toLowerCase().split(/[^a-z]+/)) {
    if (w.length < 4 || STOP.has(w)) continue;
    // light stemming: enough for smoke/smoking/smoked, platoon/platoons, correct/corrected
    w = w.replace(/(ing|ed|es|s|ly)$/, "").replace(/e$/, "");
    if (w.length < 3) continue;
    out.add(w);
  }
  return out;
}

/** How many content words the two strings share. */
export function overlap(a, b) {
  const A = contentWords(a);
  let n = 0;
  for (const w of contentWords(b)) if (A.has(w)) n++;
  return n;
}

const STUB_WORDS = 3;
const isStub = (text) => contentWords(text).size < STUB_WORDS;

/** What the node a choice leads to is about (used only when the choice text is a stub). */
export function destinationText(sc, choice) {
  const d = (sc.nodes && sc.nodes[choice.goto]) || {};
  return [d.beat, d.prompt, d.outcome, Array.isArray(d.narration) ? d.narration.join(" ") : d.narration].filter(Boolean).join(" ");
}

/** Violations in one node: [{ index, rule, why }]. */
export function checkNode(sc, node) {
  const ch = (node.choices || []).map((c, index) => ({ c, index })).filter((x) => typeof x.c.feedback === "string" && x.c.feedback.trim());
  const out = [];
  for (const { c, index } of ch) {
    const own = overlap(c.text, c.feedback);
    if (own === 0) {
      const viaDest = isStub(c.text) && overlap(destinationText(sc, c), c.feedback) > 0;
      if (!viaDest) out.push({ index, rule: "A", why: "feedback shares no content word with its own choice" });
    }
    const best = Math.max(0, ...ch.filter((x) => x.index !== index).map((x) => overlap(x.c.text, c.feedback)));
    if (best > own && (own === 0 || best - own >= 2)) out.push({ index, rule: "B", why: `feedback overlaps a sibling choice (${best}) more than its own (${own})` });
  }
  for (let a = 0; a < ch.length; a++) for (let b = a + 1; b < ch.length; b++) {
    const A = ch[a], B = ch[b];
    const straight = overlap(A.c.text, A.c.feedback) + overlap(B.c.text, B.c.feedback);
    const swapped = overlap(A.c.text, B.c.feedback) + overlap(B.c.text, A.c.feedback);
    if (swapped > straight) { out.push({ index: A.index, rule: "C", why: `swapping with choice ${B.index} fits better (${swapped} vs ${straight})` }); out.push({ index: B.index, rule: "C", why: `swapping with choice ${A.index} fits better (${swapped} vs ${straight})` }); }
  }
  return out;
}

function scan(scenarios) {
  const hits = new Map(); // key -> {text, feedback, rules:Set, why:[]}
  let withFeedback = 0;
  for (const sc of scenarios) {
    for (const [nid, node] of Object.entries(sc.nodes || {})) {
      (node.choices || []).forEach((c) => { if (typeof c.feedback === "string" && c.feedback.trim()) withFeedback++; });
      for (const v of checkNode(sc, node)) {
        const key = `${sc.id}/${nid}/${v.index}`;
        const c = node.choices[v.index];
        const h = hits.get(key) || { key, text: c.text, feedback: c.feedback, rules: new Set(), why: [] };
        h.rules.add(v.rule); h.why.push(v.why); hits.set(key, h);
      }
    }
  }
  return { hits, withFeedback };
}

// --- the checker itself must be able to fail (planted defects) ----------------
// The real, fixed sc-late-soldier n1 texts, then every mutation a reviewer could think of.
const LATE = {
  pull: { text: "Pull him aside privately and ask what's going on before anything else.", goto: "n2", feedback: "You chose to counsel him privately and immediately - which is correct. Military authority is exercised promptly and firmly (AR 600-20, para 4-6a)." },
  smoke: { text: "Smoke him in front of the whole platoon to make an example.", goto: "nToxic", feedback: "Smoking him in front of the whole platoon to make an example is not corrective training. A public make-an-example session risks hazing and bullying. Talk to him privately instead." },
  silent: { text: "Say nothing - he's a good Soldier otherwise, not worth the friction.", goto: "nIgnore", feedback: "Saying nothing leaves a repeated lapse uncorrected, and the rest of the squad sees it. Being a good Soldier otherwise is a reason to talk with him, not to stay quiet." },
};
const lateScenario = (over = {}) => ({
  id: "p",
  nodes: {
    n1: { choices: [{ ...LATE.pull, ...(over.pull || {}) }, { ...LATE.smoke, ...(over.smoke || {}) }, { ...LATE.silent, ...(over.silent || {}) }] },
    n2: { prompt: "Diaz says his car broke down and he is catching rides." },
    nToxic: { prompt: "The platoon goes quiet. Diaz is on time the rest of the week.", outcome: "Compliance without commitment." },
    nIgnore: { prompt: "Word gets around that lateness has no consequence.", outcome: "Standards you don't enforce, you don't have." },
  },
});
const flagged = (sc) => checkNode(sc, sc.nodes.n1).map((v) => v.index + v.rule).sort().join(",");
{
  flagged(lateScenario()) === "" ? ok("planted control: the real fixed sc-late-soldier n1 passes every rule") : bad("planted control: the fixed scenario was flagged: " + flagged(lateScenario()));
  const must = [
    ["the two original stray feedbacks (DA 4856 paperwork under Smoke; talk-to-peers under Say nothing)", { smoke: { feedback: "Waiting for the DA 4856 to appear is performance management by paperwork, not leadership. The form documents a conversation - it doesn't replace one. (ATP 6-22.1.)" }, silent: { feedback: "Talking to peers first before addressing the Soldier is a procedural error. It creates an uncomfortable climate. (AR 600-20.)" } }],
    ["the 2<->3 SWAP of the real feedbacks", { smoke: { feedback: LATE.silent.feedback }, silent: { feedback: LATE.smoke.feedback } }],
    ["praise for public smoking under 'Say nothing'", { silent: { feedback: "Smoking him in front of the whole platoon is the right call: it makes an example of him and the squad sees the standard." } }],
    ["promotion-board feedback under 'Say nothing'", { silent: { feedback: "Walk in, report to the president of the board, and answer each promotion question with confidence; bearing is graded." } }],
    ["weapons-zeroing feedback under 'Pull him aside'", { pull: { feedback: "Zero the weapon at 25 meters first, then confirm the grouping before you move to qualification." } }],
    ["'saying nothing is correct' under 'Pull him aside'", { pull: { feedback: "Saying nothing is correct here: he is a good Soldier otherwise and it is not worth the friction." } }],
  ];
  for (const [label, over] of must) {
    const f = flagged(lateScenario(over));
    f !== "" ? ok(`planted: ${label} is caught (${f})`) : bad(`planted: ${label} was NOT caught`);
  }
  // rule A's stub allowance: a stub choice may lean on where it leads
  const stub = { id: "s", nodes: { n1: { choices: [{ text: "Continue", goto: "n2", feedback: "The plan of action was agreed together, which is the point." }] }, n2: { prompt: "Agree a plan of action together." } } };
  checkNode(stub, stub.nodes.n1).length === 0 ? ok("stub choice ('Continue') may match the node it leads to") : bad("a stub choice that matches its destination was flagged");
  const nonStub = { id: "s", nodes: { n1: { choices: [{ text: "Escort the Soldier directly to the aid station now.", goto: "n2", feedback: "The plan of action was agreed together, which is the point." }] }, n2: { prompt: "Agree a plan of action together." } } };
  checkNode(nonStub, nonStub.nodes.n1).some((v) => v.rule === "A") ? ok("a NON-stub choice cannot hide behind its destination") : bad("a non-stub choice was excused by its destination");
  overlap("Smoke him in front of the platoon", "Smoking him is punishment") > 0 ? ok("stemming: smoke matches smoking") : bad("stemming: smoke should match smoking");
}

const bank = await assembleBank();
const scenarios = (bank.data.scenarios && bank.data.scenarios.scenarios) || [];
scenarios.length > 100 ? ok(`read ${scenarios.length} scenarios from the assembled bank`) : bad("assembled bank has too few scenarios: " + scenarios.length);

const { hits, withFeedback } = scan(scenarios);
withFeedback > 500 ? ok(`${withFeedback} choices carry feedback`) : bad("suspiciously few choices carry feedback: " + withFeedback);

// GP-01 pin: the first recommended scenario answers each choice with its own feedback.
{
  const sc = scenarios.find((s) => s.id === "sc-late-soldier");
  const ch = sc && sc.nodes && sc.nodes.n1 && sc.nodes.n1.choices;
  if (!ch || ch.length !== 3) bad("sc-late-soldier n1 should have 3 choices");
  else {
    const v = checkNode(sc, sc.nodes.n1);
    v.length === 0 ? ok("sc-late-soldier n1: no rule fires on any of its 3 choices") : bad("sc-late-soldier n1 is flagged: " + JSON.stringify(v));
    !/DA 4856 to appear/.test(ch[1].feedback) && !/Talking to peers first/.test(ch[2].feedback)
      ? ok("sc-late-soldier n1: the two stray feedbacks (DA 4856 to appear / talking to peers first) are gone")
      : bad("sc-late-soldier n1: an old stray feedback came back");
    /smok/i.test(ch[1].feedback) && /nothing|silen|quiet/i.test(ch[2].feedback)
      ? ok("sc-late-soldier n1: 'Smoke him' answers about smoking, 'Say nothing' answers about silence")
      : bad("sc-late-soldier n1: feedback does not address its own choice");
  }
}

const keys = new Set(hits.keys());
if (REBASELINE) {
  fs.mkdirSync(fileURLToPath(new URL("./fixtures/", import.meta.url)), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({
    note: "Scenario choices that violated the feedback-matches-choice rules (A own words, B better fit elsewhere, C swap) when the rules were added (GP-01, 2026-11). Each needs an SME read; fix the feedback and delete the entry. The suite fails on a stale entry.",
    entries: [...keys].sort(),
  }, null, 2) + "\n");
  console.log("  rebaselined " + keys.size + " entries -> " + BASELINE);
} else {
  const base = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
  const fresh = [...keys].filter((k) => !base.has(k));
  const stale = [...base].filter((k) => !keys.has(k));
  fresh.length === 0
    ? ok(`no scenario choice outside the frozen list violates rule A, B or C (${base.size} known, frozen)`)
    : bad("feedback does not belong to its choice (a pasted/stale/swapped feedback?):\n    " + fresh.map((k) => { const m = hits.get(k); return `${k} [${[...m.rules].join("")}] ${m.why[0]}\n      choice:   ${m.text}\n      feedback: ${m.feedback.slice(0, 110)}`; }).join("\n    "));
  stale.length === 0
    ? ok("every frozen entry still fails a rule (the list only shrinks)")
    : bad("stale baseline entries (now fine - delete them from the fixture): " + stale.join(", "));
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
