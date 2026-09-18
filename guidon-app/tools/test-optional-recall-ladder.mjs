import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(url, { waitUntil:"load" });
await page.waitForTimeout(700);
await dismissOnboarding(page);

const r = await page.evaluate(async () => {
  const L = G.memorization && G.memorization.recallLadder;
  const item = (GUIDON_SEED.board.questions || []).find(q => q.id === "creed-spirit-of-the-cav") ||
               (GUIDON_SEED.board.questions || []).find(q => Array.isArray(q.lines) && q.lines.length);
  if (!L || !item) return { missing:true };
  const initial = await L.load(item.id);
  const easy = L.prompt(item, "easy");
  const medium = L.prompt(item, "medium");
  const initials = L.prompt(item, "initials");
  const unaided = L.prompt(item, "unaided");
  let s = { level:"full", streak:0 };
  s = L.nextLevel(s, true);
  const afterOne = {...s};
  s = L.nextLevel(s, true);
  const afterTwo = {...s};
  s = L.nextLevel(s, false);
  const afterFail = {...s};
  await L.save(item.id, { enabled:true, level:"medium", streak:1 });
  const saved = await L.load(item.id);
  await L.save(item.id, { enabled:false, level:"full", streak:0 });
  return { optional:L.optional, defaultEnabled:L.defaultEnabled, placement:L.placement,
    initial, easy, medium, initials, unaided, afterOne, afterTwo, afterFail, saved,
    full:L.prompt(item,"full") };
});

!r.missing ? ok("recall ladder is registered for recitable material") : bad("recall ladder or recitable item missing");
r.optional === true && r.defaultEnabled === false && r.initial && r.initial.enabled === false
  ? ok("method is explicitly opt-in and disabled by default") : bad("optional/default-off contract failed");
r.placement === "recitation-detail" ? ok("placement is scoped to recitation detail, not main navigation") : bad("unexpected placement: " + r.placement);
(r.easy.match(/______/g)||[]).length > 0 && (r.medium.match(/______/g)||[]).length > (r.easy.match(/______/g)||[]).length
  ? ok("20% and 50% cloze prompts progressively remove more recall cues") : bad("cloze progression malformed");
r.initials && r.initials.length < r.full.length && r.unaided === ""
  ? ok("first-letter and fully unaided stages work") : bad("hard/unaided stages malformed");
r.afterOne.level === "full" && r.afterTwo.level === "easy" && r.afterFail.level === "full"
  ? ok("two successes advance and a failure steps back") : bad("adaptive progression malformed");
r.saved && r.saved.enabled === true && r.saved.level === "medium" && r.saved.streak === 1
  ? ok("opt-in state and progress persist") : bad("persisted ladder state malformed");

await browser.close();
await server.close();
console.log(fails ? `\n${fails} FAILURE(S)` : "\nOPTIONAL RECALL LADDER: all passed");
process.exit(fails ? 1 : 0);
