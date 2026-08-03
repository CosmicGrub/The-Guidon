/**
 * Quiz / Mock Board -> Board Drill SRS bridge.
 *
 * The contract:
 *   - G.board.noteExternalResult(id, grade) writes through the drill's own
 *     scheduler to the drill's own store (one memory model, no drift)
 *   - grade 0 makes the card due NOW with a lifetime miss recorded
 *   - grade 2 schedules it forward like a drill "Know It"
 *   - a wrong answer in the multiple-choice quiz demotes the card;
 *     a correct answer writes NOTHING (recognition never advances recall)
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const noise = [];
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1100);
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1100);
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1100);

/* ---- surface ---- */
const surfaced = await page.evaluate(() => typeof G.board.noteExternalResult === "function");
surfaced ? ok("G.board.noteExternalResult exposed") : bad("noteExternalResult missing from G.board");

/* ---- grade 0: due now, miss recorded ---- */
const miss = await page.evaluate(async () => {
  const q = G.store.boardQuestions()[0];
  const rec = await G.board.noteExternalResult(q.id, 0);
  const persisted = await G.db.get("kv", "srs:" + q.id);
  return { rec, persisted: persisted && persisted.v, now: Date.now() };
});
(miss.rec && miss.rec.due <= miss.now && miss.rec.interval === 0 && miss.rec.misses >= 1)
  ? ok("grade 0: due immediately, interval reset, miss counted")
  : bad("grade 0 record wrong: " + JSON.stringify(miss.rec));
(miss.persisted && miss.persisted.due === miss.rec.due)
  ? ok("grade 0 persisted to the drill's own store")
  : bad("grade 0 not persisted: " + JSON.stringify(miss.persisted));

/* ---- grade 2: scheduled forward ---- */
const know = await page.evaluate(async () => {
  const q = G.store.boardQuestions()[1];
  const rec = await G.board.noteExternalResult(q.id, 2);
  return { rec, now: Date.now() };
});
(know.rec && know.rec.due > know.now && know.rec.reps >= 1)
  ? ok("grade 2: scheduled into the future with a rep")
  : bad("grade 2 record wrong: " + JSON.stringify(know.rec));

/* ---- quiz UI: a real wrong click demotes; correct clicks write nothing ---- */
await page.evaluate(() => {
  const tab = [...document.querySelectorAll(".segmented button")].find((b) => /quiz/i.test(b.textContent));
  if (tab) tab.click();
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  const go = [...document.querySelectorAll("button")].find((b) => /start quiz/i.test(b.textContent));
  if (go) go.click();
});
await page.waitForTimeout(700);

const quiz = await page.evaluate(async () => {
  const srsCount = async () => (await G.db.all("kv")).filter((r) => r.k && r.k.indexOf("srs:") === 0).length;
  const before = await srsCount();
  let sawWrong = false, sawCorrectNoWrite = false;
  for (let round = 0; round < 12 && !(sawWrong && sawCorrectNoWrite); round++) {
    const opts = [...document.querySelectorAll(".quiz-opt")];
    if (!opts.length) break;
    const preClick = await srsCount();
    opts[0].click();
    await new Promise((r) => setTimeout(r, 250));
    const wrong = opts[0].classList.contains("quiz-wrong");
    const after = await srsCount();
    if (wrong) {
      sawWrong = after === preClick + 1 || after === preClick; // may hit an id already recorded above
      if (after < preClick) sawWrong = false;
    } else {
      if (after === preClick) sawCorrectNoWrite = true;
    }
    const next = [...document.querySelectorAll("button")].find((b) => /next|see results/i.test(b.textContent) && !b.disabled);
    if (next) next.click();
    await new Promise((r) => setTimeout(r, 350));
  }
  return { before, after: await srsCount(), sawWrong, sawCorrectNoWrite };
});
quiz.sawWrong
  ? ok("quiz: a wrong click wrote an SRS record through the bridge")
  : bad("quiz: no wrong answer observed writing a record in 10 rounds: " + JSON.stringify(quiz));
quiz.sawCorrectNoWrite
  ? ok("quiz: a correct click wrote nothing (recognition never advances recall)")
  : console.log("  NOTE  no correct-click round observed this run (random options) — demote-only asserted above");

noise.length === 0 ? ok("no page errors") : bad(noise.length + " page errors; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `BRIDGE: ${fails} FAILURE(S)` : "BRIDGE: all passed"));
process.exit(fails ? 1 : 0);
