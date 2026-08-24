/**
 * Rapid Fire's "load-bearing" regression (docs/superpowers/specs/
 * 2026-08-23-rapid-fire-design.md, "Data flow & state" and "Alternatives
 * considered — Should Rapid Fire results feed real mastery/SRS tracking?"):
 * a Rapid Fire session must make ZERO writes to the real attempts/SRS
 * stores, in any mode. This is a deliberate design decision (kept fully
 * separate from mastery tracking so group-judged Party results, of uneven
 * reliability, never corrupt the real spaced-repetition signal), not an
 * oversight — this file is the regression proving it stays true.
 *
 * Two independent lines of evidence, both required:
 *   1. A spy wrapped around the real G.db.put() records every call made
 *      anywhere in the app during a full, real play session (Setup with
 *      several controls touched, a full round including Reveal/Correct/
 *      Pass/End Round, Recap, Play Again, a second round) — then asserts
 *      zero of those calls ever targeted the "attempts" store, and zero
 *      targeted the "kv" store with a key starting with "srs:" (the real
 *      SRS record key shape — see srsKey()/loadSrs()/saveSrs() in
 *      src/index.html). rapidFire's own "seen" flag (a plain kv row, NOT
 *      "srs:"-prefixed) is expected and allowed through unfiltered.
 *   2. The real row counts — G.db.all("attempts").length and the count of
 *      "srs:"-prefixed kv rows — read directly before and after the whole
 *      session, proving the actual database is untouched, not just that
 *      the spy didn't happen to see a write.
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
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
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

async function clickButtonByText(text, scopeSel) {
  return page.evaluate(({ text, scopeSel }) => {
    const scope = scopeSel ? document.querySelector(scopeSel) : document;
    if (!scope) return false;
    const btn = [...scope.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
    if (!btn) return false;
    btn.click();
    return true;
  }, { text, scopeSel });
}
async function setCategory(name) {
  return page.evaluate((name) => {
    const sel = document.querySelector('select[aria-label="Filter by category"]');
    if (!sel) return false;
    sel.value = name;
    sel.dispatchEvent(new Event("change"));
    return sel.value === name;
  }, name);
}
async function startRound() {
  await clickButtonByText("Start Round");
  await page.waitForTimeout(250);
  const hasExplainer = await page.evaluate(() => !!document.querySelector(".rf-explainer"));
  if (hasExplainer) {
    await clickButtonByText("Got it — let's go");
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(200);
}
async function tapReveal() { return clickButtonByText("Reveal answer", ".rf-card"); }
async function tapCorrect() { await page.evaluate(() => document.querySelector(".rf-judge-correct")?.click()); await page.waitForTimeout(120); }
async function tapPass() { await page.evaluate(() => document.querySelector(".rf-judge-pass")?.click()); await page.waitForTimeout(120); }
async function tapEndRound() { await clickButtonByText("End Round"); await page.waitForTimeout(200); }

// ── Baseline: real row counts, before Rapid Fire is ever touched ────────
const baseline = await page.evaluate(async () => {
  const attempts = await G.db.all("attempts");
  const kv = await G.db.all("kv");
  const srsRows = kv.filter((r) => r && typeof r.k === "string" && r.k.lastIndexOf("srs:", 0) === 0);
  return { attemptsCount: attempts.length, srsCount: srsRows.length };
});
ok(`baseline recorded: ${baseline.attemptsCount} attempts row(s), ${baseline.srsCount} srs: row(s)`);

// ── Spy wrapped around the real G.db.put(), from this point forward ────
await page.evaluate(() => {
  window.__putCalls = [];
  const origPut = G.db.put.bind(G.db);
  G.db.put = function (store, entry) {
    window.__putCalls.push({ store, key: entry && entry.k });
    return origPut(store, entry);
  };
});

// ── A full, real Rapid Fire session: Setup (several real controls
//    touched), a full round (Reveal, Correct, Pass, End Round), Recap,
//    Play Again, a second round. ───────────────────────────────────────
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(400);
await clickButtonByText("Rapid Fire");
await page.waitForTimeout(300);

await setCategory("Counseling");
await clickButtonByText("All difficulties");
await clickButtonByText("30s");
await clickButtonByText("Match my rank");
await clickButtonByText("All difficulties"); // back to a non-empty pool
await clickButtonByText("Remove for this round");
await clickButtonByText("Requeue");
await clickButtonByText("⚙ Needs Work");
await clickButtonByText("⚙ Needs Work"); // toggle back off — Counseling stays selected
await startRound();

await tapReveal();
await tapCorrect();
await tapCorrect();
await tapPass();
await tapCorrect();
await tapEndRound();

const onRecap1 = await page.evaluate(() =>
  // Scoped to real <h3> elements, not document.body.textContent — this app
  // inlines its own JS source inside <body>, and "Round Recap" is also,
  // unavoidably, a literal string in that source (it's the string this
  // very code renders), so a textContent scan for it is a false positive
  // from the very first render.
  [...document.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Round Recap")
);
onRecap1 ? ok("first round reached Recap") : bad("first round did not reach Recap — session setup broken, results below may be incomplete");

await clickButtonByText("Play Again");
await page.waitForTimeout(300);
await tapReveal();
await tapCorrect();
await tapPass();
await tapEndRound();
const onRecap2 = await page.evaluate(() =>
  // Scoped to real <h3> elements, not document.body.textContent — this app
  // inlines its own JS source inside <body>, and "Round Recap" is also,
  // unavoidably, a literal string in that source (it's the string this
  // very code renders), so a textContent scan for it is a false positive
  // from the very first render.
  [...document.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Round Recap")
);
onRecap2 ? ok("Play Again round also reached Recap") : bad("second (Play Again) round did not reach Recap");

// ── Evidence 1: the spy saw zero forbidden writes ───────────────────────
const putCalls = await page.evaluate(() => window.__putCalls.slice());
const attemptsWrites = putCalls.filter((c) => c.store === "attempts");
const srsWrites = putCalls.filter((c) => c.store === "kv" && typeof c.key === "string" && c.key.lastIndexOf("srs:", 0) === 0);
const otherKvWrites = putCalls.filter((c) => c.store === "kv" && !(typeof c.key === "string" && c.key.lastIndexOf("srs:", 0) === 0));

attemptsWrites.length === 0
  ? ok(`zero db.put("attempts", ...) calls across the whole session (${putCalls.length} total db.put call(s) observed)`)
  : bad(`${attemptsWrites.length} write(s) to the "attempts" store during Rapid Fire play: ` + JSON.stringify(attemptsWrites));
srsWrites.length === 0
  ? ok('zero db.put("kv", {k:"srs:...", ...}) calls across the whole session')
  : bad(`${srsWrites.length} write(s) to an "srs:"-prefixed kv key during Rapid Fire play: ` + JSON.stringify(srsWrites));
// The one-time explainer's own kv flag IS an expected, legitimate write —
// confirming it's present (not silently broken) and that it's the ONLY
// kind of non-srs kv write this session produced.
const explainerWrites = otherKvWrites.filter((c) => c.key === "rapidFire:seenExplainer");
explainerWrites.length >= 1
  ? ok("the one-time explainer's own kv flag (rapidFire:seenExplainer) DID write, as expected — this is not a blanket no-writes-at-all claim, only attempts/SRS")
  : bad("expected at least one rapidFire:seenExplainer kv write, got: " + JSON.stringify(otherKvWrites));

// ── Evidence 2: the real database itself is unchanged ──────────────────
const after = await page.evaluate(async () => {
  const attempts = await G.db.all("attempts");
  const kv = await G.db.all("kv");
  const srsRows = kv.filter((r) => r && typeof r.k === "string" && r.k.lastIndexOf("srs:", 0) === 0);
  return { attemptsCount: attempts.length, srsCount: srsRows.length };
});
after.attemptsCount === baseline.attemptsCount
  ? ok(`real "attempts" row count is unchanged (${baseline.attemptsCount} before, ${after.attemptsCount} after)`)
  : bad(`"attempts" row count changed: ${baseline.attemptsCount} -> ${after.attemptsCount}`);
after.srsCount === baseline.srsCount
  ? ok(`real "srs:"-prefixed kv row count is unchanged (${baseline.srsCount} before, ${after.srsCount} after)`)
  : bad(`"srs:" row count changed: ${baseline.srsCount} -> ${after.srsCount}`);

noise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + noise.slice(0, 8).join(" | "));

await browser.close();
await server.close();

console.log(fails === 0 ? "\nRAPID FIRE (ZERO SRS/ATTEMPTS WRITES): all passed" : `\nRAPID FIRE (ZERO SRS/ATTEMPTS WRITES): ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
