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
 * THE RULE (mechanical, deliberately cheap). Across the assembled bank (static
 * seed + every content pack, tools/assemble-bank.mjs), every scenario choice
 * that has a `feedback` string must share at least one CONTENT word with its
 * own choice - the choice text PLUS the consequence it leads to (the next
 * node's beat, prompt, narration and outcome), because good feedback often
 * explains the consequence rather than repeating the wording (lower-cased,
 * words of 4+ letters, stop-words dropped, light suffix stemming: "smoke"
 * matches "smoking", "platoon" matches "platoons"). A feedback that shares
 * nothing with the choice it answers, or with where that choice leads, is
 * almost always another choice's feedback. It does not prove the feedback is RIGHT - that is a content
 * review - it catches the paste/rewrite slip.
 *
 * THE RATCHET. When this rule was added, other choices already shared no word
 * with their feedback (the audit's p6-feedback-mismatch list; many are fine -
 * a good feedback may talk about the principle rather than repeat the choice -
 * and each needs an SME read, which is a separate content wave). They are
 * frozen in tools/fixtures/scenario-feedback-match-baseline.json as
 * "<scenario id>/<node id>/<choice index>". The suite fails for:
 *   - any choice NOT in that file that shares no word with its feedback
 *     (a new slip), and
 *   - any entry in that file that no longer fails (a stale entry - delete it,
 *     so the list only ever shrinks).
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

/** True when the feedback shares at least one content word with the context. */
export function sharesAWord(context, feedback) {
  const a = contentWords(context);
  for (const w of contentWords(feedback)) if (a.has(w)) return true;
  return false;
}

/** What a choice "is about": its own text plus the node it leads to. */
export function choiceContext(sc, choice) {
  const dest = (sc.nodes && sc.nodes[choice.goto]) || {};
  return [choice.text, dest.beat, dest.prompt, dest.outcome, Array.isArray(dest.narration) ? dest.narration.join(" ") : dest.narration].filter(Boolean).join(" ");
}

function scan(scenarios) {
  const misses = [];
  let withFeedback = 0;
  for (const sc of scenarios) {
    for (const [nid, node] of Object.entries(sc.nodes || {})) {
      (node.choices || []).forEach((c, i) => {
        if (typeof c.feedback !== "string" || !c.feedback.trim()) return;
        withFeedback++;
        if (!sharesAWord(choiceContext(sc, c), c.feedback)) misses.push({ key: `${sc.id}/${nid}/${i}`, text: c.text, feedback: c.feedback });
      });
    }
  }
  return { misses, withFeedback };
}

// --- the checker itself must be able to fail (planted defects) ----------------
{
  // The two real strays from sc-late-soldier (verbatim, as shipped before the fix), plus an honest choice.
  const planted = [{ id: "p", nodes: {
    n1: { choices: [
      { text: "Pull him aside privately and ask what's going on before anything else.", goto: "n2", feedback: "You chose to counsel him privately and immediately - which is correct." },
      { text: "Smoke him in front of the whole platoon to make an example.", goto: "nToxic", feedback: "Waiting for the DA 4856 to appear is performance management by paperwork, not leadership. The form documents a conversation - it doesn't replace one. (ATP 6-22.1.)" },
      { text: "Say nothing - he's a good Soldier otherwise, not worth the friction.", goto: "nIgnore", feedback: "Talking to peers first before addressing the Soldier is a procedural error. It creates an uncomfortable climate. (AR 600-20.)" },
    ] },
    n2: { prompt: "Diaz says his car broke down and he is catching rides." },
    nToxic: { prompt: "The platoon goes quiet. Diaz is on time the rest of the week.", outcome: "Compliance without commitment. You traded long-term trust for a short-term win." },
    nIgnore: { prompt: "Word gets around that lateness has no consequence.", outcome: "Standards you don't enforce, you don't have." },
  } }];
  const r = scan(planted);
  JSON.stringify(r.misses.map((m) => m.key)) === JSON.stringify(["p/n1/1", "p/n1/2"])
    ? ok("planted: the two real stray feedbacks are caught, the honest one passes")
    : bad("planted: the matcher did not isolate the mismatched choices: " + JSON.stringify(r.misses.map((m) => m.key)));
  sharesAWord("Smoke him in front of the platoon", "Smoking him is punishment") ? ok("stemming: smoke matches smoking") : bad("stemming: smoke should match smoking");
}

const bank = await assembleBank();
const scenarios = (bank.data.scenarios && bank.data.scenarios.scenarios) || [];
scenarios.length > 100 ? ok(`read ${scenarios.length} scenarios from the assembled bank`) : bad("assembled bank has too few scenarios: " + scenarios.length);

const { misses, withFeedback } = scan(scenarios);
withFeedback > 500 ? ok(`${withFeedback} choices carry feedback`) : bad("suspiciously few choices carry feedback: " + withFeedback);

// GP-01 pin: the first recommended scenario answers each choice with its own feedback.
{
  const sc = scenarios.find((s) => s.id === "sc-late-soldier");
  const ch = sc && sc.nodes && sc.nodes.n1 && sc.nodes.n1.choices;
  if (!ch || ch.length !== 3) bad("sc-late-soldier n1 should have 3 choices");
  else {
    ch.every((c) => sharesAWord(choiceContext(sc, c), c.feedback)) ? ok("sc-late-soldier n1: every choice's feedback shares a content word with its own choice") : bad("sc-late-soldier n1 still has a mismatched feedback");
    !/DA 4856 to appear/.test(ch[1].feedback) && !/Talking to peers first/.test(ch[2].feedback)
      ? ok("sc-late-soldier n1: the two stray feedbacks (DA 4856 to appear / talking to peers first) are gone")
      : bad("sc-late-soldier n1: an old stray feedback came back");
    /smok/i.test(ch[1].feedback) && /nothing|silen|quiet/i.test(ch[2].feedback)
      ? ok("sc-late-soldier n1: 'Smoke him' answers about smoking, 'Say nothing' answers about silence")
      : bad("sc-late-soldier n1: feedback does not address its own choice");
  }
}

const keys = new Set(misses.map((m) => m.key));
if (REBASELINE) {
  fs.mkdirSync(fileURLToPath(new URL("./fixtures/", import.meta.url)), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({
    note: "Scenario choices whose feedback shares no content word with the choice text when the rule was added (GP-01, 2026-11). Each needs an SME read; fix the feedback and delete the entry. The suite fails on a stale entry.",
    entries: [...keys].sort(),
  }, null, 2) + "\n");
  console.log("  rebaselined " + keys.size + " entries -> " + BASELINE);
} else {
  const base = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
  const fresh = [...keys].filter((k) => !base.has(k));
  const stale = [...base].filter((k) => !keys.has(k));
  fresh.length === 0
    ? ok(`no new scenario choice answers with feedback that shares no word with it (${base.size} known, frozen)`)
    : bad("choice feedback shares no content word with its choice (a pasted/stale feedback?):\n    " + fresh.map((k) => { const m = misses.find((x) => x.key === k); return `${k}\n      choice:   ${m.text}\n      feedback: ${m.feedback.slice(0, 110)}`; }).join("\n    "));
  stale.length === 0
    ? ok("every frozen entry still fails the rule (the list only shrinks)")
    : bad("stale baseline entries (now fine - delete them from the fixture): " + stale.join(", "));
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
