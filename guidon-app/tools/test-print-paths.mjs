/**
 * Print paths beyond Mock Board (already covered in test-mockboard.mjs):
 * Progress's "Print Report", Profile's "Print plan" (Personal Action Plan),
 * and Writing Trainer's "Format & print memo". All three build bespoke
 * innerHTML strings by hand (util.printHTML), and all three have shipped
 * real bugs before - a stored-XSS via an unescaped scenario title (#107,
 * Progress), a stored-XSS via an unescaped profile name (#86, Action Plan),
 * and a fabricated "OFFICE-SYMBOL" placeholder printed as if it were real
 * data (#144, Memo). This exercises each path's actual printed content
 * (via #print-holder, the same technique test-mockboard.mjs uses) rather
 * than just checking the print button exists.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
await page.evaluate(() => {}).catch(() => {}); // no-op, keeps eslint-style consistency with other suites

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
// Stub window.print() up front - real print() can hang/behave oddly headless,
// and every path below only needs the #print-holder DOM it builds first.
await page.addInitScript(() => { window.print = () => {}; });
await page.evaluate(() => { window.print = () => {}; });

// Walk a real personal-account onboarding, picking a couple of concerns and
// weak points along the way, and a distinctive/malicious-looking last name,
// so the Action Plan print has real "Your inputs" content and a genuine
// escaping regression to check (#86).
await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).waitFor({ state: "visible", timeout: 8000 });
await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
await page.waitForTimeout(300);
await page.locator(".ob-rank-btn", { hasText: /^SSG$/ }).click();
const nameInp = page.locator("input.ob-input").first();
await nameInp.fill("<b>XSSNAME</b>");
await page.locator("button.ob-next", { hasText: /Next/ }).click();
await page.waitForTimeout(300);
await page.locator("button.ob-next", { hasText: /Next/ }).click(); // role -> concerns
await page.waitForTimeout(300);
await page.locator('label:has-text("AFT / physical fitness")').click();
await page.locator("button.ob-next", { hasText: /Next/ }).click(); // concerns -> weakpoints
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^Customs & Courtesies$/ }).click();
await page.locator("button", { hasText: /Build my plan/ }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^Skip$/ }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: /Save profile & start/ }).click();
await page.waitForTimeout(500);

// A training-mode custom scenario with a malicious title - real regression
// coverage for #107 (Progress Print Report's Mandatory Training table).
// No `tier` field: scenarios().filter() only excludes a scenario when it
// HAS a tier that doesn't match the active tierFilter - onboarding just set
// tierFilter to this profile's own rank tier (E6 for SSG), which would
// silently drop a tier:["E4"] scenario from Progress's Mandatory Training
// table before it ever reached the print function under test.
await page.evaluate(() => window.G.store.saveUserScenario({
  id: "sc-print-xss-" + Date.now(),
  title: "<img src=x onerror=window.__xssFired=1>",
  competency: ["Leads"], estMinutes: 2, difficulty: "Basic",
  doctrine: [], defaultMode: "training", renderModes: ["text"], scene: "TEST",
  start: "n1",
  nodes: { n1: { prompt: "p", choices: [{ text: "go", goto: "end1" }] }, end1: { prompt: "", end: true, outcome: "o" } },
}));

// ==================== 1) Progress "Print Report" ====================
await page.evaluate(() => { location.hash = "#/progress"; });
await page.waitForTimeout(500);
await page.locator("button", { hasText: /Print Report/ }).click();
await page.waitForTimeout(500);
// window.print() is stubbed, so "afterprint" never fires and printHTML's own
// cleanup (which removes #print-holder) never runs - grab THIS holder's
// content, then remove it, so the next print path's holder is the only one
// left when its own turn comes (an id selector otherwise returns the FIRST
// match in document order, i.e. this stale one, not the newest).
const progressPrint = await page.evaluate(() => {
  const h = document.querySelector("#print-holder");
  const html = h ? h.innerHTML : "";
  if (h) h.remove();
  return html;
});
/GUIDON Readiness Report/.test(progressPrint) ? ok("Progress print produces real report content") : bad("Progress print missing title: " + progressPrint.slice(0, 150));
/Leadership Requirements Model/.test(progressPrint) ? ok("Progress print includes the LRM dimension table") : bad("Progress print missing LRM table");
/Mandatory Training/.test(progressPrint) ? ok("Progress print includes the Mandatory Training section") : bad("Progress print missing Mandatory Training section");
const progressHasRawImgTag = /<img src=x onerror=/.test(progressPrint);
const progressHasEscapedTitle = /&lt;img src=x onerror=/.test(progressPrint);
(!progressHasRawImgTag && progressHasEscapedTitle)
  ? ok("Malicious scenario title is escaped in the printed Mandatory Training row (#107 regression)")
  : bad("scenario title escaping: rawTagPresent=" + progressHasRawImgTag + " escapedPresent=" + progressHasEscapedTitle);
const xssActuallyFired = await page.evaluate(() => !!window.__xssFired);
!xssActuallyFired ? ok("The injected payload did not actually execute") : bad("XSS payload executed - window.__xssFired was set");

// ==================== 2) Profile "Print plan" (Personal Action Plan) ====================
await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(500);
// Not anchored (/^Print plan$/): el()'s gi-icon shorthand prepends a real
// leading-space text node ahead of the label ("A space is slipped in when
// text follows directly" - see util.el), so textContent is " Print plan",
// which a ^-anchored regex never matches. Every other locator in this repo
// leaves gi-icon buttons unanchored for the same reason.
await page.locator("button", { hasText: /Print plan/ }).click();
await page.waitForTimeout(500);
const planPrint = await page.evaluate(() => {
  const h = document.querySelector("#print-holder");
  const html = h ? h.innerHTML : "";
  if (h) h.remove();
  return html;
});
/Personal Action Plan/.test(planPrint) ? ok("Action Plan print produces real report content") : bad("Action Plan print missing title: " + planPrint.slice(0, 150));
/Your inputs/.test(planPrint) && /physical fitness|AFT/.test(planPrint) ? ok("Action Plan print includes the Soldier's stated concerns (#143)") : bad("Action Plan print missing 'Your inputs' concerns section");
/Customs/.test(planPrint) ? ok("Action Plan print includes the Soldier's stated study gaps (#143)") : bad("Action Plan print missing study-gap content");
// lastName is uppercased on input (nameInp's own handler: .toUpperCase()),
// so "<b>XSSNAME</b>" becomes "<B>XSSNAME</B>" by the time it reaches here.
const planHasRawName = /<B>XSSNAME<\/B>/.test(planPrint);
const planHasEscapedName = /&lt;B&gt;XSSNAME&lt;\/B&gt;/.test(planPrint);
(!planHasRawName && planHasEscapedName)
  ? ok("Malicious display name is escaped in the printed Action Plan header (#86 regression)")
  : bad("display-name escaping: rawPresent=" + planHasRawName + " escapedPresent=" + planHasEscapedName);

// ==================== 3) Writing Trainer "Format & print memo" ====================
await page.evaluate(() => { location.hash = "#/write"; });
await page.waitForTimeout(400);
await page.locator(".tabbar button, .author-tabs button", { hasText: /^Memorandum$/ }).click();
await page.waitForTimeout(300);
// Deliberately leave Office symbol BLANK - the exact scenario #144 fixed.
const subjectInput = page.locator('.wr-row:has(label:text-is("SUBJECT")) input');
await subjectInput.fill("Request for Additional PT Equipment");
const bodyTextarea = page.locator('.wr-row:has(label:has-text("Body")) textarea');
await bodyTextarea.fill("Purpose: request additional equipment.");
await page.locator("button", { hasText: /Format & print memo/ }).click();
await page.waitForTimeout(500);
const memoPrint = await page.evaluate(() => {
  const h = document.querySelector("#print-holder");
  const html = h ? h.innerHTML : "";
  if (h) h.remove();
  return html;
});
/Memorandum/.test(memoPrint) ? ok("Memo print produces real report content") : bad("Memo print missing title: " + memoPrint.slice(0, 150));
/Request for Additional PT Equipment/.test(memoPrint) ? ok("Memo print includes the typed SUBJECT text") : bad("Memo print missing subject content");
/OFFICE-SYMBOL/.test(memoPrint)
  ? bad("Memo print bakes in the fake 'OFFICE-SYMBOL' placeholder with Office symbol left blank (#144 regression FAILED)")
  : ok("Memo print does NOT fabricate an 'OFFICE-SYMBOL' placeholder when the field is left blank (#144)");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

// cleanup
await page.evaluate(async () => {
  const all = (await window.G.db.allUserScenarios()) || [];
  for (const sc of all) await window.G.db.delUserScenario(sc.id);
});

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPRINT PATHS: all passed");
process.exit(fails ? 1 : 0);
