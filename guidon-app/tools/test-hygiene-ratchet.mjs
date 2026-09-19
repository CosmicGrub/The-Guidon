/**
 * The test-hygiene ratchet (tools/lint-test-hygiene.mjs) must itself be
 * shown to fail. Pure node, no browser.
 *
 * Same method tools/test-release-pipeline.mjs uses for lint-ci-matrix: point
 * the real tool at a stand-in tools/ directory and a stand-in baseline
 * (--tools / --baseline), plant one defect at a time, and watch the lint name
 * it. Then the ratchet itself: --write may lower a number, must refuse to
 * raise one, and must refuse a new suite that arrives with any.
 *
 * It also pins the heuristic for rule (c), literal deck sizes, from both
 * sides: the shapes that really broke suites are flagged, and the look-alikes
 * that are NOT deck sizes (screen tiles called "cards", a fixture the suite
 * made itself, a product limit) are left alone - measured on the real suites,
 * where every line it flags today is a genuine content-size literal.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, bad, check, finish } from "./testkit.mjs";
import { scan, countsOf, mask } from "./lint-test-hygiene.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LINT = path.join(HERE, "lint-test-hygiene.mjs");
const lint = (...args) => {
  const r = spawnSync(process.execPath, [LINT, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const rules = (src) => countsOf(scan(src));
const total = (c) => c.sleeps + c.swallowedWaits + c.literalCounts;

/* =====================================================================
   1. The real tree passes against the committed baseline.
   ===================================================================== */
{
  const real = lint();
  check(real.code === 0 && /LINT-TEST-HYGIENE: all passed/.test(real.out), "the real tools/ directory passes against the committed baseline", () => real.out.split("\n").filter((l) => /FAIL/.test(l)).slice(0, 5).join(" | "));
}

/* =====================================================================
   2. What counts, and what does not (scan() on small sources).
   ===================================================================== */
{
  // (a) sleeps - in code only
  check(rules("await page.waitForTimeout(500);\nawait other.waitForTimeout(20);").sleeps === 2, "(a) every .waitForTimeout( call is counted, on any page variable");
  check(total(rules("// await page.waitForTimeout(500);\n/* page.waitForTimeout(1) */\nconst s = \"page.waitForTimeout(500)\";\nconst t = `await page.waitForTimeout(${n})`;\nconst r = /waitForTimeout\\(/;")) === 0,
    "a sleep that is only MENTIONED - in a comment, a string, a template or a regex - is not counted");
  check(rules("await page.waitForTimeout(400); // hygiene-ok: proving nothing happens needs a fixed window").sleeps === 0
    && rules("// hygiene-ok: the animation has no end event to wait for\nawait page.waitForTimeout(400);").sleeps === 0,
    "// hygiene-ok: <reason> exempts its own line, or the line under a comment-only line");
  check(rules("await page.waitForTimeout(400); // hygiene-ok:").sleeps === 1 && rules("await page.waitForTimeout(400); // hygiene-ok: meh").sleeps === 1,
    "a bare or token \"hygiene-ok\" with no real reason exempts nothing");

  // (b) swallowed waits
  const chained = [
    "await page.waitForFunction(() => window.ready, null, { timeout: 5000 }).catch(() => {});",
    "await page.locator(\".row\", { hasText: /^All (done)$/ }).waitFor({ state: \"attached\" }).catch((e) => {});",
    "await page.waitForSelector(\"[data-x]\")\n  .catch(function () {});",
    "await page.waitForFunction(\n  () => document.querySelectorAll(\".a\").length > 1,\n  { timeout: 5000 }\n).catch(() => { /* let the assertion below report it */ });",
    "await expect(page.locator(\".x\")).toBeVisible().catch(() => {});",
    "try { await page.waitForSelector(\".late\", { timeout: 2000 }); } catch (e) {}",
    "try {\n  await page.waitForFunction(() => window.done);\n} catch {\n  // nothing\n}",
  ];
  const missed = chained.filter((s) => rules(s).swallowedWaits !== 1);
  check(missed.length === 0, `(b) a wait whose failure is thrown away is counted in all ${chained.length} shapes: .catch(() => {}), multi-line, function () {}, a comment-only handler, expect(), try/catch with an empty catch`, () => "not counted: " + JSON.stringify(missed));
  const fine = [
    "const reached = await page.waitForFunction(() => window.ready).then(() => true).catch(() => false);",
    "await server.close().catch(() => {});",
    "await page.locator(\"button\").click().catch(() => {});",
    "try { await page.waitForSelector(\".late\"); } catch (e) { found = false; }",
    "const text = await page.locator(\".v\").textContent().catch(() => null);",
    "const hit = await until(page, () => window.ready);",
  ];
  const wrongly = fine.filter((s) => total(rules(s)) !== 0);
  check(wrongly.length === 0, "(b) a wait whose outcome is USED (.then(() => true).catch(() => false), a catch that records the miss, until()) and a swallowed close()/click() are not counted", () => "wrongly counted: " + JSON.stringify(wrongly));

  // (c) literal deck sizes: the shapes that really broke suites ...
  const deckSizes = [
    "for (let i = 0; i < 17; i++) await tapPass(); // 17 real AFT questions",
    "// AFT has 17 real questions\nfor (let i = 0; i < 17; i++) { await tapQzCard(); await tapPass(); }",
    "aftPool.length === 17 ? ok(\"pool ok\") : bad(\"pool\");",
    "window.G.store.boardQuestions().filter((q) => q.category === \"Army Fitness Test (AFT)\").length === 17 ? ok(\"a\") : bad(\"b\");",
    "expect(category.length===34, \"canonical board bank contains exactly 34 Cybersecurity & OPSEC questions\");",
    "realCatCount === 93\n  ? ok(\"every category has a row\")\n  : bad(\"rows\");",
    "mos.length === 40 ? ok(\"all 40 92A prompts are in the bank\") : bad(mos.length + \" found\");",
    "if (scenarioCount !== 195) bad(\"scenario count drifted\");",
    "Object.keys(byCategory).length === 94 ? ok(\"x\") : bad(\"y\");",
    "17 === deckSize ? ok(\"x\") : bad(\"y\");",
  ];
  const unflagged = deckSizes.filter((s) => rules(s).literalCounts < 1);
  check(unflagged.length === 0, `(c) a literal deck size is flagged in all ${deckSizes.length} shapes, including the two loops that broke in 2026-09 and a filtered boardQuestions() length`, () => "not flagged: " + JSON.stringify(unflagged));
  // ... and the look-alikes that are not deck sizes
  const notDecks = [
    "wideCards.length === 9 ? ok(\"9 cards in a three-column grid\") : bad(\"grid\");",
    "narrowGrid.cardCount === 6 && narrowGrid.allSameLeft ? ok(\"a\") : bad(\"b\");",
    "hostDeck && hostDeck.names.length === 2 && hostDeck.names.every(inPicks) ? ok(\"the deck is exactly the two ticked categories\") : bad(\"x\");",
    "rows.length === 2 && rows.some((r) => r.text === TITLE) ? ok(\"both texts are back\") : bad(\"rows\");",
    "dueSeed === 12 ? ok(\"seeded 12 real board questions as due for review\") : bad(\"expected 12 seeded questions, got \" + dueSeed);",
    "creedLines.length === 20 ? ok(\"creed-4 carries the full 20-line Creed\") : bad(\"lines\");",
    "initialCardCount === 60 ? ok(\"default view renders exactly TRAIN_CAP (60) scenario cards\") : bad(\"count\");",
    "twelve.ticked.length === 12 && /up to 12 categories/.test(capText) ? ok(\"the picker stops at 12\") : bad(\"cap\");",
    "mapNodeCount === 2 ? ok(\"Map tab renders one box per node (2 for QA Test Scenario)\") : bad(\"map\");",
    "category.length === 1 ? ok(\"one\") : bad(\"none\");",
    "qs.length >= 12 ? ok(\"enough cards to run\") : bad(\"bank too small\");",
    "for (let i = 0; i < 5; i++) await page.keyboard.press(\"Tab\");",
    "res.status === 200 && body.length === 64 ? ok(\"hash\") : bad(\"hash\");",
  ];
  const wronglyFlagged = notDecks.filter((s) => rules(s).literalCounts !== 0);
  check(wronglyFlagged.length === 0, `(c) none of ${notDecks.length} look-alikes is flagged: screen tiles called "cards", a fixture the suite made, a product limit, a floor (>=), 0/1, a plain loop`, () => "wrongly flagged: " + JSON.stringify(wronglyFlagged));

  check(mask("a = \"x)\"; // (\nb(/\\)/, 'y(');").replace(/[^()]/g, "") === "()", "mask() leaves only real code parens - strings, comments and regex literals cannot unbalance the scan");
}

/* =====================================================================
   3. The ratchet, against a stand-in tools/ directory.
   ===================================================================== */
const root = mkdtempSync(path.join(tmpdir(), "guidon-hygiene-"));
try {
  const tools = path.join(root, "tools");
  mkdirSync(tools);
  const baseline = path.join(root, "baseline.json");
  const put = (name, body) => writeFileSync(path.join(tools, name), body);
  const run = (...extra) => lint("--tools", tools, "--baseline", baseline, ...extra);
  const SLEEP = "await page.waitForTimeout(300);\n";
  const CLEAN = "import { bootApp, finish } from \"./testkit.mjs\";\nawait finish(\"X\");\n";

  put("test-old.mjs", SLEEP + SLEEP);
  put("test-clean.mjs", CLEAN);
  put("helper.mjs", SLEEP.repeat(9)); // not a test-*.mjs file: out of scope

  const noBase = run();
  check(noBase.code === 1 && /missing or is not valid JSON/.test(noBase.out), "with no baseline the lint fails rather than passing everything", () => noBase.out);
  const needInit = run("--write");
  check(needInit.code === 1 && /--write --init/.test(needInit.out) && !existsSync(baseline), "--write will not invent a first baseline by accident (that takes --init)", () => needInit.out);
  const init = run("--write", "--init");
  const b0 = readFileSync(baseline, "utf8");
  check(init.code === 0 && JSON.parse(b0).files["test-old.mjs"].sleeps === 2 && !("test-clean.mjs" in JSON.parse(b0).files) && !("helper.mjs" in JSON.parse(b0).files),
    "--write --init records what exists: the old suite's 2 sleeps, and no row for a clean suite or a non-test file", () => init.out + b0);
  check(run().code === 0, "the stand-in directory then passes");

  // (1) an existing suite gets worse
  put("test-old.mjs", SLEEP + SLEEP + SLEEP);
  const worse = run();
  check(worse.code === 1 && /\(1\) tools\/test-old\.mjs: \(a\) fixed sleeps rose from 2 to 3/.test(worse.out) && /line 3/.test(worse.out) && /until\(page, fn\)/.test(worse.out),
    "PLANTED: one more sleep in an existing suite fails, naming the file, the line and what to use instead", () => worse.out);
  const refuse = run("--write");
  check(refuse.code === 1 && /--write refused/.test(refuse.out) && readFileSync(baseline, "utf8") === b0, "--write REFUSES to raise a number, and leaves the baseline byte-for-byte alone", () => refuse.out);
  put("test-old.mjs", SLEEP + SLEEP);

  // (2) new suites arrive with each defect
  const planted = [
    ["test-new-sleep.mjs", SLEEP, /\(2\) tools\/test-new-sleep\.mjs is a new suite with 1 \(a\) fixed sleeps/],
    ["test-new-swallow.mjs", "await page.waitForFunction(() => window.ready).catch(() => {});\n", /\(2\) tools\/test-new-swallow\.mjs is a new suite with 1 \(b\) swallowed waits/],
    ["test-new-literal.mjs", "for (let i = 0; i < 17; i++) await tapPass(); // 17 real AFT questions\n", /\(2\) tools\/test-new-literal\.mjs is a new suite with 1 \(c\) literal deck sizes/],
  ];
  for (const [name, body, expectRe] of planted) {
    put(name, body);
    const r = run();
    const w = run("--write");
    check(r.code === 1 && expectRe.test(r.out) && w.code === 1 && readFileSync(baseline, "utf8") === b0,
      `PLANTED: a new suite arriving with ${name.replace(/^test-new-|\.mjs$/g, "")} fails by name, and --write refuses to grandfather it`, () => r.out + w.out);
    rmSync(path.join(tools, name));
  }
  put("test-new-excused.mjs", "await page.waitForTimeout(400); // hygiene-ok: proving that nothing happens needs a fixed window\n");
  check(run().code === 0, "a new suite whose one sleep carries a written reason passes");
  rmSync(path.join(tools, "test-new-excused.mjs"));

  // (3) improvements must be banked, and only --write banks them
  put("test-old.mjs", SLEEP);
  const better = run();
  check(better.code === 1 && /\(3\) tools\/test-old\.mjs: \(a\) fixed sleeps fell from 2 to 1/.test(better.out) && /--write/.test(better.out), "removing a sleep without banking it fails, so the number cannot creep back up unnoticed", () => better.out);
  const banked = run("--write");
  const b1 = readFileSync(baseline, "utf8");
  check(banked.code === 0 && JSON.parse(b1).files["test-old.mjs"].sleeps === 1 && run().code === 0, "--write LOWERS the baseline to 1, and the lint passes again", () => banked.out);
  run("--write");
  check(readFileSync(baseline, "utf8") === b1 && !b1.includes("\r"), "a second --write changes nothing (idempotent, LF-only)");
  put("test-old.mjs", SLEEP + SLEEP);
  check(run().code === 1 && run("--write").code === 1 && readFileSync(baseline, "utf8") === b1, "the old count is now a regression: 2 sleeps fail against the banked 1");

  put("test-old.mjs", CLEAN);
  const gone = run("--write");
  check(gone.code === 0 && !("test-old.mjs" in JSON.parse(readFileSync(baseline, "utf8")).files), "a suite that reaches zero leaves the baseline altogether", () => gone.out);
  writeFileSync(baseline, b1);
  rmSync(path.join(tools, "test-old.mjs"));
  const orphan = run();
  check(orphan.code === 1 && /\(3\) the baseline has a row for tools\/test-old\.mjs, which no longer exists/.test(orphan.out), "a baseline row for a deleted suite fails until --write removes it", () => orphan.out);
} finally {
  rmSync(root, { recursive: true, force: true });
}

await finish("TEST HYGIENE RATCHET");
