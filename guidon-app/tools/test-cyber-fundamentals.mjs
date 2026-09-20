/**
 * Cybersecurity Fundamentals: the new module's cards, dictionary terms, self-check, and rendering on #/cyber-opsec
 *
 * WHY THIS SUITE EXISTS: src/app-modules/07-cyber-fundamentals.js wraps
 * G.opsec.render (owned by 06-opsec-cyber-curriculum.js) rather than
 * replacing it - if the wrapper stopped calling the original render, the
 * existing Cybersecurity & OPSEC section (34 cards, 4 scenarios, its own
 * audit) would silently vanish from #/cyber-opsec while the route still
 * "worked". If the new module's own board-card push were removed or
 * mis-wired, the 35 new cards would still exist as source text but never
 * reach the running bank, the Practice button, or Board Drill - exactly the
 * ESP32-deck-61-cards-short failure mode the module manifest was built to
 * catch (tools/module-manifest.mjs's own doc comment). This suite drives the
 * real screen and Board Drill to prove all three layers - seed content,
 * screen rendering, Board Drill filtering - actually connect.
 */
import { bootApp, check, finish, waitForRoute, clickWhenStable, until, liveCount, expectNoConsoleNoise } from "./testkit.mjs";

const boot = await bootApp({ viewport: { width: 390, height: 844 } });
const { page, noise } = boot;

// The module's own data is the source of truth for every count below - never
// a number typed in this file, so a content edit cannot break this suite.
const truth = await page.evaluate(() => {
  const f = window.G && window.G.opsec && window.G.opsec.fundamentals;
  const terms = (window.GUIDON_SEED.acronyms && window.GUIDON_SEED.acronyms.terms) || [];
  const byA = (a) => terms.find((t) => String(t.a || "").toUpperCase() === a.toUpperCase());
  return {
    hasFundamentals: !!f,
    category: f && f.CATEGORY,
    cardCount: f ? f.cards.length : 0,
    termCount: f ? f.terms.length : 0,
    selfCheckCount: f ? f.selfCheck.length : 0,
    ped: byA("PED"),
    gfe: byA("GFE"),
    raas: byA("RaaS"),
  };
});
check(truth.hasFundamentals && truth.category === "Cybersecurity Fundamentals", "G.opsec.fundamentals is exposed with the expected category", () => JSON.stringify(truth));
check(truth.cardCount > 0 && truth.termCount > 0 && truth.selfCheckCount > 0, "the module reports a non-empty card bank, dictionary and self-check", () => JSON.stringify(truth));

// The dictionary MERGE, not overwrite, rule: PED already meant "processing,
// exploitation, and dissemination" before this module loaded. If the new
// Portable Electronic Device sense replaced it instead of merging, a Soldier
// looking up PED before a board would lose the seed's own meaning.
check(!!truth.ped && /processing, exploitation, and dissemination/i.test(truth.ped.d) && /portable electronic device/i.test(truth.ped.d),
  "PED keeps its seed meaning (processing/exploitation/dissemination) AND gains the new Portable Electronic Device sense",
  () => "PED definition: " + JSON.stringify(truth.ped));
check(!!truth.gfe && /government[- ]furnished equipment/i.test(truth.gfe.d), "GFE's existing definition is kept (merged, not duplicated)", () => JSON.stringify(truth.gfe));
check(!!truth.raas && /ransomware-as-a-service/i.test(truth.raas.d), "a brand-new term (RaaS) is added to the dictionary", () => JSON.stringify(truth.raas));

// The cards actually reached the running bank Board Drill and the board lint
// both read from - not just G.opsec.fundamentals's own private copy.
const bankCount = await liveCount(page, { kind: "board", category: "Cybersecurity Fundamentals" });
check(bankCount === truth.cardCount, `all ${truth.cardCount} Cybersecurity Fundamentals cards are in the live question bank`, () => `bank reports ${bankCount}`);

// Both sections render on the SAME #/cyber-opsec route: the original module's
// own section (proving the wrapper still calls through) and the new one.
await waitForRoute(page, "#/cyber-opsec", { ready: "h2" });
const headings = await page.evaluate(() => Array.from(document.querySelectorAll("#route h2")).map((h) => h.textContent.trim()));
check(headings.includes("Cybersecurity & OPSEC"), "the original module's section still renders (the wrapper calls through)", () => JSON.stringify(headings));
check(headings.includes("Cybersecurity Fundamentals"), "the new module's section renders on the same route", () => JSON.stringify(headings));

// The new section's own audit is present and distinct from the original
// module's 10-question audit (both must coexist without id collisions).
const auditHeadings = await page.evaluate(() => Array.from(document.querySelectorAll("#route h3")).map((h) => h.textContent.trim()));
check(auditHeadings.includes("10-question knowledge audit"), "the original 10-question audit heading is still there", () => JSON.stringify(auditHeadings));
check(auditHeadings.includes(`${truth.selfCheckCount}-question knowledge audit`), "the new module's own knowledge-audit heading is there, sized to its own question count", () => JSON.stringify(auditHeadings));

// Answer the new section's first self-check question and confirm feedback -
// proving the new audit is wired up, not just a static heading.
const firstChoice = page.locator('[data-selfcheck="cyberfund-question"] ~ [role="group"] button').first();
await clickWhenStable(page, firstChoice);
const gotFeedback = await until(page, () => !!document.querySelector('[data-selfcheck="cyberfund-feedback"]'));
check(gotFeedback, "answering the new section's first self-check question shows feedback (correct/incorrect, why, source)", "no feedback panel appeared");
if (gotFeedback) {
  const fbText = await page.locator('[data-selfcheck="cyberfund-feedback"]').first().textContent();
  check(/Correct\.|Not quite\./.test(fbText) && /Source:/.test(fbText), "the feedback names a verdict and a source", () => JSON.stringify(fbText));
}

// The Practice button hands Board Drill the right category filter, and
// Board Drill actually narrows to it - the same _filterCat convention every
// other "Practice these questions" button in the app uses.
const practiceBtn = page.locator("button", { hasText: /^Practice Cybersecurity Fundamentals questions \(\d+\)$/ });
const practiceBtnCount = await practiceBtn.count();
check(practiceBtnCount === 1, "a single Practice button is labeled with the live card count", () => "matches: " + practiceBtnCount);
await clickWhenStable(page, practiceBtn);
await waitForRoute(page, "#/board", { ready: ".qz-front, select" });
const filteredCount = await liveCount(page, { kind: "board", scope: "visible", category: "Cybersecurity Fundamentals" });
check(filteredCount === truth.cardCount, "Board Drill, opened from the Practice button, is filtered to exactly the Cybersecurity Fundamentals cards", () => `visible pool: ${filteredCount}`);

expectNoConsoleNoise(noise);
await finish("CYBER FUNDAMENTALS");
