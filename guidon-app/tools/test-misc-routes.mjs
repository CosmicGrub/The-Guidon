/**
 * Real interaction coverage for four routes the generic sweeps only ever
 * render once and never touch: #/money's BRS tab (a calculator, never
 * fed real numbers), #/kiosk (the Guided Tour never actually stepped
 * through), #/search (the global search route - #/doctrine, #/dictionary
 * and #/resources already get this treatment in test-search-views.mjs, but
 * #/search itself never has), and #/privacy (swept structurally by
 * test-csp.mjs/test-contrast-full.mjs/test-a11y-tree.mjs, but never
 * checked for specific real content).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
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

// ============================================================
// #/money -> BRS & TSP tab (the module's default tab): match-capture
// calculator. Feed it a below-the-match contribution % and confirm the
// on-screen dollar figures and the warning copy match G.finance
// .matchDollars() -- the app's own real calculation function -- exactly,
// then feed it the full 5% and confirm the warn/good state actually flips.
// ============================================================
await page.evaluate(() => { location.hash = "#/money"; });
await page.waitForTimeout(600);

const brsTabActive = await page.evaluate(() => {
  const t = [...document.querySelectorAll(".tabbar .tab")].find((b) => /BRS & TSP/.test(b.textContent || ""));
  return !!t && t.classList.contains("active");
});
brsTabActive ? ok("#/money lands on the BRS & TSP tab by default") : bad("#/money did not land on the BRS & TSP tab");

const payIn = page.locator(".fin-calc-row input").first();
const pctIn = page.locator(".fin-calc-row input").nth(1);

function readOutCells() {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll(".fin-out-cell").forEach((c) => {
      const k = c.querySelector(".fin-out-k").textContent;
      const v = c.querySelector(".fin-out-v").textContent;
      out[k] = v;
    });
    return out;
  });
}

// --- 3%: below the 5% needed to capture the full match ---
await payIn.fill("2500");
await pctIn.fill("3");
await page.waitForTimeout(300); // past the 60ms recalc debounce

const m3 = await page.evaluate(() => window.G.finance.matchDollars(2500, 3));
const m5 = await page.evaluate(() => window.G.finance.matchDollars(2500, 5));
const cells3 = await readOutCells();

m3.capturedFull === false
  ? ok("BRS calculator: G.finance.matchDollars(2500, 3).capturedFull is false (real precondition for the warning state)")
  : bad("BRS calculator: test precondition wrong - matchDollars(2500,3) unexpectedly captures the full match");
cells3["You put in"] === money(m3.yours)
  ? ok(`BRS calculator at 3%: "You put in" = ${cells3["You put in"]} matches the real yours=${money(m3.yours)}`)
  : bad(`BRS calculator at 3%: "You put in" was ${cells3["You put in"]}, expected ${money(m3.yours)}`);
cells3["Match"] === money(m3.match)
  ? ok(`BRS calculator at 3%: "Match" = ${cells3["Match"]} matches the real dollar-for-dollar-under-3% formula`)
  : bad(`BRS calculator at 3%: "Match" was ${cells3["Match"]}, expected ${money(m3.match)}`);
cells3["Total / month"] === money(m3.allTotal)
  ? ok(`BRS calculator at 3%: "Total / month" = ${cells3["Total / month"]} matches expected`)
  : bad(`BRS calculator at 3%: "Total / month" was ${cells3["Total / month"]}, expected ${money(m3.allTotal)}`);

const warnText3 = await page.evaluate(() => (document.querySelector(".fin-warn") || {}).textContent || "");
const missed = m5.govTotal - m3.govTotal;
const expectedWarn = "At 5% you'd get " + money(m5.govTotal) + "/mo from the government";
(warnText3.includes(expectedWarn) && warnText3.includes(money(missed)))
  ? ok(`BRS calculator at 3%: warning banner quotes the real shortfall (${money(m5.govTotal)}/mo full match, ${money(missed)}/mo left on the table)`)
  : bad(`BRS calculator at 3%: warning text was "${warnText3}", expected it to include "${expectedWarn}" and ${money(missed)}`);

// --- 5%: exactly captures the full match; the warn state should flip to good ---
await pctIn.fill("5");
await page.waitForTimeout(300);
const cells5 = await readOutCells();
cells5["Match"] === money(m5.match)
  ? ok(`BRS calculator at 5%: "Match" recalculated to the real capped value ${cells5["Match"]}`)
  : bad(`BRS calculator at 5%: "Match" was ${cells5["Match"]}, expected ${money(m5.match)}`);
const goodText5 = await page.evaluate(() => (document.querySelector(".fin-good") || {}).textContent || "");
const warnGone5 = await page.evaluate(() => !document.querySelector(".fin-warn"));
(warnGone5 && /capturing the full government match/i.test(goodText5))
  ? ok("BRS calculator at 5%: the warning banner is replaced by the 'capturing the full match' confirmation")
  : bad(`BRS calculator at 5%: warnGone=${warnGone5}, goodText="${goodText5}"`);

// ============================================================
// #/kiosk -> Guided Tour: click through real steps and confirm the content
// actually advances (title + description text change to match the real
// route/DEMO_NOTES data), not just a step counter incrementing.
// ============================================================
await page.evaluate(() => { location.hash = "#/kiosk"; });
await page.waitForTimeout(600);

const tourCard = page.locator("button.ob-mode-card", { hasText: /Step through every section/i });
(await tourCard.count()) > 0 ? ok("#/kiosk shows the 'Guided Tour' mode-picker card") : bad("#/kiosk: 'Guided Tour' card not found");
await tourCard.click();
await page.waitForTimeout(400);

function readStep() {
  return page.evaluate(() => ({
    stepLabel: (document.querySelector(".ob-step-num") || {}).textContent || "",
    title: (document.querySelector(".ob-kiosk-card h3") || {}).textContent || "",
    desc: (document.querySelector(".ob-kiosk-card .view-intro") || {}).textContent || "",
    activeDots: document.querySelectorAll(".ob-kiosk-dot.active").length,
  }));
}

const expectedSteps = await page.evaluate(() =>
  window.G.routes.filter((r) => r.hash !== "#/kiosk" && r.hash !== "#/profile").map((r) => r.hash)
);

// Step 1 should be Home (routes[0], first non-excluded route)
const step1 = await readStep();
(step1.stepLabel.includes("Step 1 of " + expectedSteps.length) && /^Home$/.test(step1.title))
  ? ok(`Guided Tour step 1: "${step1.stepLabel}" / "${step1.title}" (matches ROUTES[0])`)
  : bad(`Guided Tour step 1: stepLabel="${step1.stepLabel}" title="${step1.title}"`);

await page.locator("button", { hasText: "Next →" }).click();
await page.waitForTimeout(300);
const step2 = await readStep();
(step2.stepLabel.includes("Step 2 of " + expectedSteps.length) && /^Train$/.test(step2.title) && step2.desc !== step1.desc)
  ? ok(`Guided Tour step 2 (after Next): "${step2.stepLabel}" / "${step2.title}" - real content changed, not just the counter`)
  : bad(`Guided Tour step 2: stepLabel="${step2.stepLabel}" title="${step2.title}" desc changed=${step2.desc !== step1.desc}`);

await page.locator("button", { hasText: "Next →" }).click();
await page.waitForTimeout(300);
const step3 = await readStep();
(step3.stepLabel.includes("Step 3 of " + expectedSteps.length) && /^Learn$/.test(step3.title))
  ? ok(`Guided Tour step 3 (after Next again): "${step3.stepLabel}" / "${step3.title}"`)
  : bad(`Guided Tour step 3: stepLabel="${step3.stepLabel}" title="${step3.title}"`);
step3.activeDots === 1 ? ok("Guided Tour: exactly one tracker dot is marked active at step 3") : bad("Guided Tour: " + step3.activeDots + " active tracker dots at step 3, expected 1");

await page.locator("button", { hasText: "← Prev" }).click();
await page.waitForTimeout(300);
const back2 = await readStep();
(back2.stepLabel.includes("Step 2 of " + expectedSteps.length) && back2.title === step2.title && back2.desc === step2.desc)
  ? ok("Guided Tour: '← Prev' returns to step 2 with the exact same Train content")
  : bad(`Guided Tour: after Prev, stepLabel="${back2.stepLabel}" title="${back2.title}"`);

const sessionStep = await page.evaluate(() => sessionStorage.getItem("guidon-demo-step"));
sessionStep === "1" ? ok("Guided Tour: current step (index 1 = step 2) is persisted to sessionStorage for back/resume") : bad('Guided Tour: sessionStorage step was "' + sessionStep + '", expected "1"');

// Roadmap audit round 5, "Kiosk/Demo Center" bucket: a persistent "TOUR:
// Step N of M" badge now shows in the topbar while mid Guided Tour (see
// G.kioskBadge in index.html) - confirm it tracks the real current step
// and that its Resume button returns to #/kiosk without touching either
// sessionStorage key (unlike Free Mode's Exit, tested further below).
const tourBadgeText = await page.evaluate(() => (document.querySelector("#demo-mode-badge") || {}).textContent || "");
/TOUR: Step 2 of \d+/.test(tourBadgeText)
  ? ok(`Guided Tour: the persistent tour badge reads "${tourBadgeText}", matching the real current step (2)`)
  : bad(`Guided Tour: tour badge text was "${tourBadgeText}", expected it to match /TOUR: Step 2 of \\d+/`);
await page.locator("#demo-mode-badge button", { hasText: "Resume" }).click();
await page.waitForTimeout(400);
const hashAfterResume = await page.evaluate(() => location.hash);
const stepKeyAfterResume = await page.evaluate(() => sessionStorage.getItem("guidon-demo-step"));
hashAfterResume === "#/kiosk" ? ok("Guided Tour badge: 'Resume' returns to #/kiosk") : bad(`Guided Tour badge: 'Resume' navigated to "${hashAfterResume}", expected "#/kiosk"`);
stepKeyAfterResume === "1"
  ? ok("Guided Tour badge: 'Resume' leaves sessionStorage untouched, landing back on the same step (2) — not a fresh Exit")
  : bad(`Guided Tour badge: 'guidon-demo-step' was "${stepKeyAfterResume}" after Resume, expected "1" (unchanged)`);

// ============================================================
// #/kiosk -> Guided Tour: advance all the way to the final step and click
// "End tour", then verify BOTH sessionStorage keys clear. Regression test
// for the fix documented in profile.js's doneBtn comment (enhancement
// backlog round 4): "End tour" originally cleared only guidon-demo-step,
// not guidon-demo-mode, which silently skipped the mode picker on the next
// visit to #/kiosk and dropped the user straight back into a resumed tour.
// ============================================================
while (await page.locator("button", { hasText: "Next →" }).count()) {
  await page.locator("button", { hasText: "Next →" }).click();
  await page.waitForTimeout(150);
}
const endTourBtn = page.locator("button", { hasText: "End tour" });
(await endTourBtn.count()) > 0 ? ok("Guided Tour: reaching the final step swaps 'Next →' for 'End tour'") : bad("Guided Tour: 'End tour' button not found at the final step");
await endTourBtn.click();
await page.waitForTimeout(400);

const hashAfterEndTour = await page.evaluate(() => location.hash);
const stepKeyAfterEnd = await page.evaluate(() => sessionStorage.getItem("guidon-demo-step"));
const modeKeyAfterEnd = await page.evaluate(() => sessionStorage.getItem("guidon-demo-mode"));
const badgeGoneAfterEnd = await page.evaluate(() => !document.getElementById("demo-mode-badge"));
hashAfterEndTour === "#/home" ? ok("Guided Tour: 'End tour' navigates to #/home") : bad(`Guided Tour: 'End tour' navigated to "${hashAfterEndTour}", expected "#/home"`);
stepKeyAfterEnd === null ? ok("Guided Tour: 'End tour' clears sessionStorage 'guidon-demo-step'") : bad(`Guided Tour: 'guidon-demo-step' was "${stepKeyAfterEnd}" after End tour, expected null`);
modeKeyAfterEnd === null
  ? ok("Guided Tour: 'End tour' clears sessionStorage 'guidon-demo-mode' too (regression test for the round-4 fix - previously only guidon-demo-step was cleared)")
  : bad(`Guided Tour: 'guidon-demo-mode' was "${modeKeyAfterEnd}" after End tour, expected null (regression: round-4 fix)`);
badgeGoneAfterEnd ? ok("Guided Tour: 'End tour' removes the persistent tour badge") : bad("Guided Tour: #demo-mode-badge still present after 'End tour'");

// Re-visiting #/kiosk after "End tour" must show the mode picker again, not
// silently resume a tour - the exact failure mode the round-4 fix prevents.
await page.evaluate(() => { location.hash = "#/kiosk"; });
await page.waitForTimeout(400);
const showsPickerAfterEnd = await page.evaluate(() => !!document.querySelector(".ob-mode-grid") && !document.querySelector(".ob-kiosk-card"));
showsPickerAfterEnd
  ? ok("#/kiosk after 'End tour': shows the mode picker again, not a resumed tour")
  : bad("#/kiosk after 'End tour': did not show the mode picker (tour resumed silently — the round-4 regression)");

// ============================================================
// #/kiosk -> Free Mode: picking Free Mode drops straight into #/home and
// raises the persistent "DEMO MODE" badge with a one-tap Exit — neither the
// mode itself nor the badge previously had any test coverage.
// ============================================================
const freeCard = page.locator("button.ob-mode-card", { hasText: /Explore on your own/i });
(await freeCard.count()) > 0 ? ok("#/kiosk shows the 'Free Mode' mode-picker card") : bad("#/kiosk: 'Free Mode' card not found");
await freeCard.click();
await page.waitForTimeout(400);

const hashAfterFree = await page.evaluate(() => location.hash);
hashAfterFree === "#/home" ? ok("Free Mode: choosing it navigates to #/home") : bad(`Free Mode: navigated to "${hashAfterFree}", expected "#/home"`);

const badgeTextAfterFree = await page.evaluate(() => (document.querySelector("#demo-mode-badge") || {}).textContent || "");
/DEMO MODE/.test(badgeTextAfterFree)
  ? ok('Free Mode: the persistent "DEMO MODE" badge appears in the topbar')
  : bad(`Free Mode: #demo-mode-badge text was "${badgeTextAfterFree}", expected it to include "DEMO MODE"`);

const modeKeyAfterFree = await page.evaluate(() => sessionStorage.getItem("guidon-demo-mode"));
modeKeyAfterFree === "free" ? ok('Free Mode: sessionStorage "guidon-demo-mode" is "free"') : bad(`Free Mode: sessionStorage "guidon-demo-mode" was "${modeKeyAfterFree}", expected "free"`);

// Badge's one-tap Exit: clears session storage, removes itself, and returns
// to #/kiosk.
await page.locator("#demo-mode-badge button", { hasText: "Exit" }).click();
await page.waitForTimeout(400);

const hashAfterExit = await page.evaluate(() => location.hash);
const modeKeyAfterExit = await page.evaluate(() => sessionStorage.getItem("guidon-demo-mode"));
const badgeGoneAfterExit = await page.evaluate(() => !document.getElementById("demo-mode-badge"));
hashAfterExit === "#/kiosk" ? ok("Free Mode Exit: returns to #/kiosk") : bad(`Free Mode Exit: hash was "${hashAfterExit}", expected "#/kiosk"`);
modeKeyAfterExit === null ? ok('Free Mode Exit: clears sessionStorage "guidon-demo-mode"') : bad(`Free Mode Exit: sessionStorage "guidon-demo-mode" was "${modeKeyAfterExit}", expected null`);
badgeGoneAfterExit ? ok("Free Mode Exit: removes the DEMO MODE badge from the topbar") : bad("Free Mode Exit: #demo-mode-badge still present after clicking Exit");

// ============================================================
// #/search -> global search: a query chosen after reading the real filter
// logic in views.search, verified against real content read directly from
// the app's own data (store.scenarios/boardQuestions/doctrine/etc.) rather
// than guessed. "reflective belt" hits exactly one doctrine entry; "PT
// test" hits three different content types at once, so the per-domain
// distribution bar is checked too.
// ============================================================
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(500);

const searchInput = page.locator('input[aria-label="Global search"]');
await searchInput.fill("reflective belt");
await page.waitForTimeout(300); // past the 120ms debounce

const countText = await page.evaluate(() => (document.querySelector(".search-count") || {}).textContent || "");
countText === "1 result"
  ? ok('Search "reflective belt": exactly 1 result, as verified against the real doctrine data')
  : bad(`Search "reflective belt": count text was "${countText}", expected "1 result"`);

const hitTitle = await page.evaluate(() => (document.querySelector(".search-hit-title") || {}).textContent || "");
hitTitle.includes("Physical Fitness Uniform (PFU) Standards")
  ? ok(`Search "reflective belt": the single hit is the real doctrine entry "${hitTitle}"`)
  : bad(`Search "reflective belt": hit title was "${hitTitle}", expected it to include "Physical Fitness Uniform (PFU) Standards"`);

const sectionHead = await page.evaluate(() => (document.querySelector(".search-section-head") || {}).textContent || "");
/Doctrine/.test(sectionHead)
  ? ok(`Search "reflective belt": result is grouped under the Doctrine section ("${sectionHead}")`)
  : bad(`Search "reflective belt": section head was "${sectionHead}", expected it to mention Doctrine`);

// Clicking the hit should navigate to the real route for that content type.
await page.locator(".search-hit").first().click();
await page.waitForTimeout(400);
const hashAfterClick = await page.evaluate(() => location.hash);
hashAfterClick === "#/doctrine"
  ? ok('Search "reflective belt": clicking the hit navigates to #/doctrine')
  : bad(`Search "reflective belt": clicking the hit navigated to "${hashAfterClick}", expected "#/doctrine"`);

// A second query spanning three different content types at once, to prove
// the cross-category breakdown is real and specific too. Roadmap Tier 3
// batch 2 replaced the old plain-text ".search-breakdown" line with a
// clickable ".search-dist-bar" of ".search-dist-seg" segments (see
// views.search in src/index.html) - same underlying per-domain counts,
// surfaced as segment titles instead of one joined string.
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(500);
const searchInput2 = page.locator('input[aria-label="Global search"]');
await searchInput2.fill("PT test");
await page.waitForTimeout(300);

const countText2 = await page.evaluate(() => (document.querySelector(".search-count") || {}).textContent || "");
const segTitles2 = await page.evaluate(() => [...document.querySelectorAll(".search-dist-seg")].map((s) => s.title));
countText2 === "3 results"
  ? ok('Search "PT test": exactly 3 results across scenario/board/lesson content')
  : bad(`Search "PT test": count text was "${countText2}", expected "3 results"`);
(segTitles2.some((t) => t.startsWith("1 Scenarios")) && segTitles2.some((t) => t.startsWith("1 Board Q")) && segTitles2.some((t) => t.startsWith("1 Lessons")))
  ? ok(`Search "PT test": distribution bar correctly attributes 1 hit to each of scenario/board/lesson (${JSON.stringify(segTitles2)})`)
  : bad(`Search "PT test": distribution bar segment titles were ${JSON.stringify(segTitles2)}`);

// Audit finding (rank/MOS scoping pass): typing an MOS code into the app's
// own search box previously returned nothing, despite a 164-entry MOS
// database existing two taps away - "92a" (case-insensitive, matches the
// MOS code field) hits exactly one real entry (92A) verified directly
// against the seed, with zero collision against either query above.
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(500);
const searchInput3 = page.locator('input[aria-label="Global search"]');
await searchInput3.fill("92a");
await page.waitForTimeout(300);
const countText3 = await page.evaluate(() => (document.querySelector(".search-count") || {}).textContent || "");
countText3 === "1 result"
  ? ok('Search "92a": exactly 1 result, a real MOS entry the global search previously never indexed')
  : bad(`Search "92a": count text was "${countText3}", expected "1 result"`);
const hitTitle3 = await page.evaluate(() => (document.querySelector(".search-hit-title") || {}).textContent || "");
hitTitle3.includes("92A")
  ? ok(`Search "92a": the hit is the real MOS entry ("${hitTitle3}")`)
  : bad(`Search "92a": hit title was "${hitTitle3}", expected it to include "92A"`);
const sectionHead3 = await page.evaluate(() => (document.querySelector(".search-section-head") || {}).textContent || "");
/MOS/.test(sectionHead3)
  ? ok(`Search "92a": result is grouped under the MOS/Career section ("${sectionHead3}")`)
  : bad(`Search "92a": section head was "${sectionHead3}", expected it to mention MOS`);
// Clicking through should land on #/career with the code prefilled via
// G.career._searchSeed - not just navigate there empty.
await page.locator(".search-hit").first().click();
await page.waitForTimeout(500);
const hashAfterMosClick = await page.evaluate(() => location.hash);
const careerInputValue = await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="MOS code or title"], .panel input[type="text"]');
  return inp ? inp.value : null;
});
hashAfterMosClick === "#/career"
  ? ok('Search "92a": clicking the hit navigates to #/career')
  : bad(`Search "92a": clicking the hit navigated to "${hashAfterMosClick}", expected "#/career"`);
const careerResultVisible = await page.evaluate(() => (document.body.textContent || "").includes("Petroleum") || (document.body.textContent || "").includes("92A"));
careerResultVisible
  ? ok("Search \"92a\": the Career Center auto-prefills and renders the 92A result, not a blank search box")
  : bad("Search \"92a\": Career Center did not show the 92A result after the search hand-off");

// ============================================================
// #/privacy -> real, substantive content (not just structural presence).
// Already swept for CSP/contrast/a11y-tree structurally elsewhere; this
// checks the actual policy text, in particular the squad-roster
// backup-exclusion behavior, which is a real, currently-true claim about
// the app's backup/export logic (see G.backup.exportAll / the roster
// opt-in), not boilerplate.
// ============================================================
await page.evaluate(() => { location.hash = "#/privacy"; });
await page.waitForTimeout(500);

const heading = await page.evaluate(() => (document.querySelector(".section-title h2") || {}).textContent || "");
heading === "Privacy Policy" ? ok('#/privacy renders the "Privacy Policy" heading') : bad(`#/privacy heading was "${heading}"`);

const sectionHeadings = await page.evaluate(() => [...document.querySelectorAll(".panel h3")].map((h) => h.textContent));
sectionHeadings.length === 12
  ? ok(`#/privacy renders all 12 real policy sections (none silently dropped)`)
  : bad(`#/privacy rendered ${sectionHeadings.length} section headings, expected 12: ${JSON.stringify(sectionHeadings)}`);

const rosterSection = await page.evaluate(() => {
  const h3 = [...document.querySelectorAll(".panel h3")].find((h) => /squad roster gets extra protection/i.test(h.textContent || ""));
  if (!h3) return null;
  const panel = h3.closest(".panel");
  return [...panel.querySelectorAll("p")].map((p) => p.textContent).join(" ");
});
rosterSection
  ? (/excluded by default/i.test(rosterSection) && /explicit opt-in/i.test(rosterSection)
      ? ok('#/privacy: "The squad roster gets extra protection" section states the real backup-exclusion behavior (excluded by default, explicit opt-in to include)')
      : bad(`#/privacy: squad roster section text did not match expected claims: "${rosterSection}"`))
  : bad('#/privacy: "The squad roster gets extra protection" section not found');

const contactSection = await page.evaluate(() => {
  const h3 = [...document.querySelectorAll(".panel h3")].find((h) => /^Contact$/i.test((h.textContent || "").trim()));
  return h3 ? h3.closest(".panel").textContent : "";
});
contactSection.includes("ctsolomon95@gmail.com")
  ? ok("#/privacy: Contact section lists the real developer contact address")
  : bad(`#/privacy: Contact section did not include the expected address: "${contactSection}"`);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad(relevantNoise.length + " console msg(s); first: " + relevantNoise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `MISC ROUTES: ${fails} FAILURE(S)` : "MISC ROUTES: all passed"));
process.exit(fails ? 1 : 0);
