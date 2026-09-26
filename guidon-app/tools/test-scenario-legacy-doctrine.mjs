/**
 * A scenario a Soldier authored and saved with the OLD Scenario Builder blank
 * template still reads correctly.
 *
 * WHY THIS SUITE EXISTS. Until ROADMAP item F, the builder's blank template
 * gave a new scenario one doctrine reference written {ref, para, asOf}. Item
 * F renamed the shape to {pub, edition, para, quoteKind} and fixed the
 * template - but a scenario a Soldier had ALREADY saved stays in IndexedDB
 * in the old shape. Every reader of `doctrine` (the After-Action Review
 * line, the printed AAR, the builder's Publication box) looks at `pub`, so
 * for that Soldier the AAR read "Doctrine: undefined (1-34)" and the
 * builder's Publication box came up blank.
 *
 * The fix (index.html, readableScenario) puts a legacy reference into today's
 * shape IN MEMORY, where the authored scenarios are loaded (boot, and every
 * rescan after a save/import/restore). It never rewrites the stored row.
 *
 * WHAT IT PROVES (each assertion can FAIL - the fix was reverted to see it):
 *   1. Legacy rows put straight into IndexedDB (the way an old build saved
 *      them) come back from G.store in today's shape: ref -> pub, para kept,
 *      asOf -> edition only when it is plainly a date, quoteKind paraphrase.
 *      A row already in today's shape, and the plain topic tags some
 *      scenarios keep in `doctrine`, come back untouched.
 *   2. The stored row is NOT rewritten by any of the reads below: it is
 *      byte-for-byte what was saved, after boot, after playing the scenario,
 *      after opening it in the builder.
 *   3. The real After-Action Review, played to its end in the real engine,
 *      prints "Doctrine: ADP 6-22 (1-34)" - never "undefined" - and so does
 *      the printed AAR sheet.
 *   4. The real builder opens the saved scenario with the Publication,
 *      Paragraph and Edition boxes filled in.
 *   5. It holds after a full page reload too (the boot-time load, not just
 *      the rescan after a save).
 *   6. Only when the Soldier saves it themselves does the row change, and
 *      then it is stored in today's shape.
 */
import { bootApp, waitForBoot, waitForRoute, until, untilAsync, clickWhenStable, check, expectNoConsoleNoise, finish, PERSONAL_PROFILE } from "./testkit.mjs";

const boot = await bootApp({ viewport: { width: 1200, height: 900 }, profile: { ...PERSONAL_PROFILE } });
const { page, noise } = boot;
await waitForRoute(page, "#/home");

const node = (id, extra = {}) => Object.assign({
  n1: { prompt: "Decide.", choices: [{ text: "Do the right thing.", goto: "end1", score: { Leads: 2 }, feedback: "Right." }] },
  end1: { prompt: "", end: true, outcome: "Done." },
}, extra);
const base = (id, title, doctrine) => ({
  id, title, summary: "A legacy-shaped scenario.", tier: ["E4"], competency: ["Leads"], estMinutes: 2, difficulty: "Basic",
  doctrine, defaultMode: "cyoa", renderModes: ["cyoa"], scene: "TEST - 0900", start: "n1", nodes: node(id),
});
const CURRENT = { pub: "AR 600-20", edition: "2020-07", para: "4-6b", quoteKind: "paraphrase" };
// What an OLD build saved: the blank template's own {ref, para, asOf}.
const LEGACY = [
  base("sc-legacy-1", "Legacy One (old template)", [{ ref: "ADP 6-22", para: "1-34", asOf: "2019-07" }]),
  base("sc-legacy-2", "Legacy Two (asOf is not a date)", [{ ref: "FM 7-22", para: "", asOf: "last checked by me" }]),
  base("sc-legacy-3", "Legacy Three (old and new mixed)", [{ ref: "AR 27-10", para: "3-3c", asOf: "2020" }, CURRENT]),
  base("sc-legacy-4", "Legacy Four (plain topic tags)", ["army-values", "discipline"]),
  base("sc-legacy-5", "Legacy Five (already current)", [CURRENT]),
];

/* ---------- 1. legacy rows, put in the way an old build saved them ---------- */
console.log("1. legacy rows read back in today's shape");
await page.evaluate(async (rows) => {
  for (const r of rows) await G.db.saveUserScenario(JSON.parse(JSON.stringify(r)));   // straight to IndexedDB, bypassing store
  await G.store.reloadUserScenarios();
}, LEGACY);
const readBack = await page.evaluate(() => Object.fromEntries(G.store.userScenarios().map((s) => [s.id, s.doctrine])));
check(JSON.stringify(readBack["sc-legacy-1"]) === JSON.stringify([{ pub: "ADP 6-22", edition: "2019-07", para: "1-34", quoteKind: "paraphrase" }]),
  "{ref, para, asOf} reads as {pub, edition, para, quoteKind}: ref becomes pub, para is kept, a date asOf becomes the edition", () => JSON.stringify(readBack["sc-legacy-1"]));
check(JSON.stringify(readBack["sc-legacy-2"]) === JSON.stringify([{ pub: "FM 7-22", edition: "", para: "", quoteKind: "paraphrase" }]),
  "an asOf that is not plainly a date is dropped, never shown as an edition", () => JSON.stringify(readBack["sc-legacy-2"]));
check(JSON.stringify(readBack["sc-legacy-3"]) === JSON.stringify([{ pub: "AR 27-10", edition: "2020", para: "3-3c", quoteKind: "paraphrase" }, CURRENT]),
  "an old reference beside a current one: only the old one is converted (a year alone counts as a date)", () => JSON.stringify(readBack["sc-legacy-3"]));
check(JSON.stringify(readBack["sc-legacy-4"]) === JSON.stringify(["army-values", "discipline"]), "plain topic tags in `doctrine` come back exactly as they were", () => JSON.stringify(readBack["sc-legacy-4"]));
check(JSON.stringify(readBack["sc-legacy-5"]) === JSON.stringify([CURRENT]), "a reference already in today's shape comes back exactly as it was", () => JSON.stringify(readBack["sc-legacy-5"]));
const sameObject = await page.evaluate(() => { const s = G.store.readableScenario; const cur = { id: "x", doctrine: [{ pub: "AR 1-1", edition: "", para: "", quoteKind: "paraphrase" }] }; return s(cur) === cur; });
check(sameObject, "a scenario with nothing to convert is handed back as the very same object (no copy, no churn)");

/* ---------- 2. the stored rows are never rewritten by a read ---------- */
const storedNow = () => page.evaluate(async () => JSON.stringify(((await G.db.allUserScenarios()) || []).sort((a, b) => (a.id < b.id ? -1 : 1))));
console.log("\n2. the stored rows are never rewritten by a read");
const storedAtStart = await storedNow();
const expectedStored = JSON.stringify(LEGACY.map((r) => JSON.parse(JSON.stringify(r))).sort((a, b) => (a.id < b.id ? -1 : 1)));
check(storedAtStart === expectedStored, "after loading, the rows in IndexedDB are byte-for-byte what the old build saved (normalised in memory only)", () => storedAtStart.slice(0, 300));

/* ---------- 3. the real After-Action Review ---------- */
console.log("\n3. the After-Action Review and the printed sheet");
await page.evaluate(() => { window.__printed = []; G.util.printHTML = (t, h) => { window.__printed.push({ t, h }); }; });
async function playToAar(id) {
  await page.evaluate((id) => {
    document.querySelectorAll("#legacy-host").forEach((n) => n.remove());
    const d = document.createElement("div"); d.id = "legacy-host"; document.body.appendChild(d);
    G.engine.run(id, "cyoa", d, null);
  }, id);
  for (let i = 0; i < 8; i++) {
    const done = await until(page, () => /Doctrine:/.test((document.querySelector("#legacy-host") || {}).textContent || ""), null, { timeout: 700 });
    if (done) break;
    await page.evaluate(() => {
      const host = document.querySelector("#legacy-host");
      const btns = [...host.querySelectorAll("button")].filter((x) => !x.disabled);
      const b = btns.find((x) => /Continue/i.test(x.textContent)) || btns.find((x) => /Do the right thing/.test(x.textContent));
      if (b) b.click();
    });
  }
  return page.evaluate(() => {
    const host = document.querySelector("#legacy-host");
    const hint = [...host.querySelectorAll(".hint")].map((h) => h.textContent).find((t) => /^Doctrine:/.test(t)) || null;
    return { hint, text: host.textContent };
  });
}
const aar1 = await playToAar("sc-legacy-1");
check(aar1.hint === "Doctrine: ADP 6-22 (1-34)", "the on-screen After-Action Review reads \"Doctrine: ADP 6-22 (1-34)\" for a scenario saved with the old template", () => JSON.stringify(aar1.hint) + " / " + aar1.text.slice(-200));
check(!/undefined/.test(aar1.text), "...and nothing on that screen says \"undefined\"");
await page.evaluate(() => { [...document.querySelectorAll("#legacy-host button")].find((b) => /Print \/ Save/.test(b.textContent)).click(); });
const printed = await page.evaluate(() => (window.__printed[window.__printed.length - 1] || {}).h || "");
check(/<strong>Doctrine:<\/strong> ADP 6-22 \(1-34\)/.test(printed) && !/undefined/.test(printed), "the printed AAR sheet carries \"ADP 6-22 (1-34)\" too, never \"undefined\"", () => printed.slice(-400));
const aar3 = await playToAar("sc-legacy-3");
check(aar3.hint === "Doctrine: AR 27-10 (3-3c)  ·  AR 600-20 (4-6b)", "a scenario with an old and a new reference reads both, in order", () => JSON.stringify(aar3.hint));
await page.evaluate(() => document.querySelectorAll("#legacy-host").forEach((n) => n.remove()));

/* ---------- 4. the real builder ---------- */
console.log("\n4. the Scenario Builder");
async function openInBuilder(title) {
  await waitForRoute(page, "#/author", { fresh: true, ready: "button:has-text('New Scenario')" });
  const card = page.locator(".card", { hasText: title }).first();
  await card.waitFor({ state: "visible" });
  await clickWhenStable(page, card.locator("button", { hasText: /^Edit$/ }));
  await page.locator('input[aria-label="Doctrine reference 1 publication"]').waitFor({ state: "visible" });
  return page.evaluate(() => [1, 2].map((n) => {
    const f = (w) => (document.querySelector('input[aria-label="Doctrine reference ' + n + " " + w + '"]') || {}).value;
    return { pub: f("publication"), para: f("paragraph"), edition: f("edition") };
  }));
}
const b1 = await openInBuilder("Legacy One");
check(b1[0].pub === "ADP 6-22" && b1[0].para === "1-34" && b1[0].edition === "2019-07", "the builder's Publication, Paragraph and Edition boxes are filled in for a scenario saved with the old template", () => JSON.stringify(b1));
const storedAfterBuilder = await storedNow();
check(storedAfterBuilder === storedAtStart, "opening it in the builder did not rewrite the stored row");

/* ---------- 5. a full reload: the boot-time load ---------- */
console.log("\n5. after a full page reload");
await page.reload();
await waitForBoot(page);
const afterReload = await page.evaluate(() => Object.fromEntries(G.store.userScenarios().map((s) => [s.id, s.doctrine])));
check(JSON.stringify(afterReload["sc-legacy-1"]) === JSON.stringify(readBack["sc-legacy-1"]) && JSON.stringify(afterReload["sc-legacy-3"]) === JSON.stringify(readBack["sc-legacy-3"]), "the boot-time load converts them the same way (not only the rescan after a save)", () => JSON.stringify(afterReload));
const storedAfterReload = await storedNow();
check(storedAfterReload === storedAtStart, "...and a reload still leaves the stored rows exactly as saved");

/* ---------- 6. only the Soldier's own Save changes the row ---------- */
console.log("\n6. saving it yourself stores today's shape");
await openInBuilder("Legacy One");
await clickWhenStable(page, page.locator("button", { hasText: /^Save$/ }));
const savedRow = await untilAsync(page, async () => {
  const r = ((await G.db.allUserScenarios()) || []).find((s) => s.id === "sc-legacy-1");
  return !!(r && r.doctrine && r.doctrine[0] && r.doctrine[0].pub === "ADP 6-22");
}, null);
const row1 = await page.evaluate(async () => ((await G.db.allUserScenarios()) || []).find((s) => s.id === "sc-legacy-1"));
check(savedRow && JSON.stringify(row1.doctrine) === JSON.stringify([{ pub: "ADP 6-22", edition: "2019-07", para: "1-34", quoteKind: "paraphrase" }]), "after the Soldier clicks Save, the row is stored in today's shape {pub, edition, para, quoteKind}", () => JSON.stringify(row1 && row1.doctrine));
const row3 = await page.evaluate(async () => ((await G.db.allUserScenarios()) || []).find((s) => s.id === "sc-legacy-3"));
check(Array.isArray(row3.doctrine) && row3.doctrine[0].ref === "AR 27-10" && row3.doctrine[0].pub === undefined, "...while a scenario they did not save is still exactly as it was", () => JSON.stringify(row3.doctrine));

// leave nothing behind
await page.evaluate(async () => { for (const s of (await G.db.allUserScenarios()) || []) if (/^sc-legacy-/.test(s.id)) await G.db.delUserScenario(s.id); });
expectNoConsoleNoise(noise);
await finish("SCENARIO LEGACY DOCTRINE");
