/**
 * Quiz / Mock Board -> SRS write-failure handling.
 *
 * G.board.noteExternalResult() (board.js) used to swallow ANY failure from
 * its underlying loadSrs()/saveSrs() write with a bare `catch (e) { return
 * null; }` - no G.selfheal entry, no console line, nothing. Both real call
 * sites (Quiz's selectOption() miss branch, Mock Board's score-button click
 * handler) fire noteExternalResult() without awaiting it or checking the
 * result, so a failed grade write - a real recall/miss the Soldier just
 * produced - could vanish completely: not in the drill's own schedule, not
 * in Diagnostics' self-heal log (js/selfheal.js, the same "log + surface,
 * never silently succeed" mechanism every OTHER silent repair/reject path
 * in this app already reports through - settings/profile backfill, backup-
 * import row rejection, service-worker/storage repairs), not anywhere.
 *
 * Fixed by (1) having noteExternalResult's catch block log the swallowed
 * failure to G.selfheal before returning null, and (2) having both call
 * sites react to a null result with a user-facing toast, instead of
 * discarding the settled promise outright.
 *
 * This test forces a REAL G.db.put() rejection scoped to "srs:"-prefixed kv
 * writes (the exact write saveSrs()/noteExternalResult() perform) and
 * proves the failure is no longer silent from three angles:
 *   1. the direct API (G.board.noteExternalResult) still returns null, but
 *      now ALSO leaves a matching G.selfheal entry - the pre-fix source
 *      returns null here too (so that alone wouldn't catch a regression)
 *      but never touches G.selfheal, so this specific assertion fails
 *      against the old code and passes against the fix.
 *   2. Quiz's real wrong-answer click (the actual .quiz-opt UI, not a
 *      direct API call) surfaces a failure toast when the write underneath
 *      it fails - the old fire-and-forget call site had no branch that
 *      could ever show this.
 *   3. Mock Board's real score-button click does the same.
 * A final control run (no injected failure) proves the fix doesn't spam a
 * false-positive toast or self-heal entry on ordinary, successful grading.
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

// Install a targeted G.db.put() failure switch: rejects only "srs:"-keyed kv
// writes (the exact write path under test) while every other kv write -
// including G.selfheal's OWN log entry, which is not "srs:"-keyed - still
// goes through untouched. Mirrors a real IndexedDB failure (quota exceeded,
// blocked connection, corrupted row) without breaking navigation or the
// self-heal log we're asserting against.
await page.evaluate(() => {
  window.__realPut = G.db.put.bind(G.db);
  window.__failSrsPuts = false;
  G.db.put = (store, value) => {
    if (window.__failSrsPuts && store === "kv" && value && typeof value.k === "string" && value.k.indexOf("srs:") === 0) {
      return Promise.reject(new Error("simulated SRS write failure"));
    }
    return window.__realPut(store, value);
  };
});

/* ---- 1: direct API - failure must be logged to G.selfheal, not just returned as null ---- */
const direct = await page.evaluate(async () => {
  window.__failSrsPuts = true;
  const q = G.store.boardQuestions()[0];
  const rec = await G.board.noteExternalResult(q.id, 0);
  window.__failSrsPuts = false;
  // noteExternalResult's own selfheal.log() call is itself fire-and-forget
  // (matches the established G.selfheal.log() convention elsewhere in the
  // app - see settings-backfill at store.js's init()), so give it a beat to
  // finish its own db.get/db.put round trip before reading it back.
  await new Promise((r) => setTimeout(r, 250));
  const entries = await G.selfheal.recent(5);
  return { id: q.id, rec, entries };
});
direct.rec === null
  ? ok("noteExternalResult still returns null on a write failure (contract unchanged)")
  : bad("noteExternalResult should return null on a write failure, got: " + JSON.stringify(direct.rec));
const loggedEntry = direct.entries.find((e) => e.key === direct.id && e.kind === "srs-write-fail");
loggedEntry
  ? ok("the swallowed write failure is logged to G.selfheal (kind 'srs-write-fail', key = question id) - discoverable in Diagnostics")
  : bad("no matching G.selfheal entry for the failed write - it is still silently swallowed. Recent entries: " + JSON.stringify(direct.entries));

/* ---- 2: Quiz UI - a real wrong click must toast on a real write failure ---- */
await page.evaluate(() => {
  const tab = [...document.querySelectorAll(".segmented button")].find((b) => /quiz/i.test(b.textContent));
  if (tab) tab.click();
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const go = [...document.querySelectorAll("button")].find((b) => /start quiz/i.test(b.textContent));
  if (go) go.click();
});
await page.waitForTimeout(500);

await page.evaluate(() => {
  window.__failSrsPuts = true;
  const t = document.getElementById("toast");
  if (t) t.classList.remove("show");
});

let quizAttemptedWrong = false, quizToastSeen = false;
for (let round = 0; round < 12 && !quizToastSeen; round++) {
  const hasOpts = await page.evaluate(() => {
    const opts = [...document.querySelectorAll(".quiz-opt")];
    if (!opts.length) return false;
    opts[0].click();
    return true;
  });
  if (!hasOpts) break;
  await page.waitForTimeout(400);
  const wrong = await page.evaluate(() => !!document.querySelector(".quiz-opt.quiz-wrong"));
  if (wrong) {
    quizAttemptedWrong = true;
    quizToastSeen = await page.evaluate(() => {
      const t = document.getElementById("toast");
      return !!(t && t.classList.contains("show") && /couldn.?t save that grade/i.test(t.textContent || ""));
    });
  }
  const advanced = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((b) => /next|see results/i.test(b.textContent) && !b.disabled);
    if (b) { b.click(); return true; }
    return false;
  });
  await page.waitForTimeout(300);
  if (!advanced) break;
}
quizAttemptedWrong
  ? ok("Quiz: exercised a real wrong-answer click during the failure window")
  : bad("Quiz: never observed a wrong-answer click in 12 rounds - test scenario didn't run");
quizToastSeen
  ? ok("Quiz: a real wrong-answer click surfaces a failure toast when the SRS write underneath it fails")
  : bad("Quiz: no failure toast appeared after a wrong click with the SRS write forced to fail");

await page.evaluate(() => { window.__failSrsPuts = false; });

/* ---- 3: Mock Board UI - a real score click must toast on a real write failure ---- */
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(500);
await page.locator("button", { hasText: /^Mock Board$/ }).click();
await page.waitForTimeout(400);
await page.locator("select").first().selectOption("5");
await page.locator("button.mb-start", { hasText: /begin board/i }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: /I've reported/i }).click();
await page.waitForTimeout(300);

await page.evaluate(() => {
  window.__failSrsPuts = true;
  const t = document.getElementById("toast");
  if (t) t.classList.remove("show");
});
await page.locator("button.mb-reveal", { hasText: /reveal answer/i }).click();
await page.waitForTimeout(150);
await page.locator("button.mb-score-btn").first().click();
await page.waitForTimeout(400);
const mockToastSeen = await page.evaluate(() => {
  const t = document.getElementById("toast");
  return !!(t && t.classList.contains("show") && /couldn.?t save that grade/i.test(t.textContent || ""));
});
mockToastSeen
  ? ok("Mock Board: a real score click surfaces a failure toast when the SRS write underneath it fails")
  : bad("Mock Board: no failure toast appeared after scoring with the SRS write forced to fail");

await page.evaluate(() => { window.__failSrsPuts = false; });

/* ---- 4: control run - no injected failure means no false-positive noise ---- */
const happy = await page.evaluate(async () => {
  const countBefore = await G.selfheal.count();
  const t = document.getElementById("toast");
  if (t) t.classList.remove("show");
  const q = G.store.boardQuestions()[1];
  const rec = await G.board.noteExternalResult(q.id, 2);
  await new Promise((r) => setTimeout(r, 250));
  const countAfter = await G.selfheal.count();
  const toastShown = !!(t && t.classList.contains("show"));
  return { rec, countBefore, countAfter, toastShown };
});
(happy.rec && happy.countAfter === happy.countBefore)
  ? ok("a successful write does not add a self-heal entry (no false positives)")
  : bad("self-heal count changed on a successful write: before=" + happy.countBefore + " after=" + happy.countAfter + " rec=" + JSON.stringify(happy.rec));
!happy.toastShown
  ? ok("a successful write does not toast a failure warning")
  : bad("toast incorrectly shown after a successful write");

noise.length === 0 ? ok("no page errors") : bad(noise.length + " page errors; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `SRS WRITE FAILURE: ${fails} FAILURE(S)` : "SRS WRITE FAILURE: all passed"));
process.exit(fails ? 1 : 0);
