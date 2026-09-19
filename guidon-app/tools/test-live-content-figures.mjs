/**
 * Live content figures: wherever the APP tells a Soldier how much it holds, the
 * number on screen is the real one.
 *
 * The tooling side of this is tools/content-manifest.mjs (no suite, tool or
 * document types a content count any more). This is the same rule for the
 * screen, because the same mistake had shipped there twice:
 *
 *   - the Guided Tour's "Board Drill" stop said "984 board cards" while the
 *     bank held well over a thousand;
 *   - the "How current is this?" page said the doctrine library had "336
 *     entries" - in the one screen that exists to catch stale numbers.
 *
 * Both are now read from the content the app has actually loaded. This suite
 * drives the real screens and compares what is DISPLAYED with the committed
 * content manifest (tools/content-manifest.json), which is itself held to the
 * live bank by `npm run lint:patterns`:
 *
 *   1. Guided Tour -> Highlights -> the Board Drill stop
 *   2. the Board entry in the main menu (its hover / long-press description)
 *   3. How current is this? -> the Doctrine and the Terms cards
 *   4. a sweep of every tour stop, every section description and every
 *      "How current is this?" card for ANY quoted card / term / doctrine /
 *      scenario / MOS count the manifest disagrees with - so the next typed
 *      number fails here the day it goes stale, not three releases later.
 *
 * The expected figures come from the manifest, never from this file.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { loadManifest, docDisagreements } from "./content-manifest.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const manifest = loadManifest();
const say = (n) => Number(n).toLocaleString("en-US");
const CARDS = say(manifest.totals.board), ENTRIES = say(manifest.totals.doctrine), TERMS = say(manifest.totals.acronyms);

const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);

/* ---- 1. Guided Tour -> Highlights -> Board Drill ---- */
await page.evaluate(() => { location.hash = "#/kiosk"; });
const highlights = page.locator("button.ob-mode-card", { hasText: /The best of GUIDON, fast/i });
await highlights.waitFor({ timeout: 15000 });
await highlights.click();
await page.waitForSelector(".ob-kiosk-card h3", { timeout: 15000 });
const readStop = () => page.evaluate(() => ({
  title: (document.querySelector(".ob-kiosk-card h3") || {}).textContent || "",
  desc: (document.querySelector(".ob-kiosk-card .view-intro") || {}).textContent || "",
}));
let stop = await readStop();
for (let i = 0; i < 20 && stop.title !== "Board Drill"; i++) {
  const next = page.locator("button", { hasText: "Next →" });
  if (!(await next.count())) break;
  await next.click();
  await page.waitForFunction((was) => ((document.querySelector(".ob-kiosk-card h3") || {}).textContent || "") !== was, stop.title, { timeout: 5000 }).catch(() => {});
  stop = await readStop();
}
stop.title === "Board Drill" ? ok("Guided Tour > Highlights reaches the Board Drill stop") : bad('never reached the "Board Drill" stop (stuck on "' + stop.title + '")');
stop.desc.startsWith(CARDS + " board cards")
  ? ok(`the Board Drill stop says "${stop.desc.slice(0, 40)}..." - the ${CARDS} cards the content manifest records (it said 984)`)
  : bad(`the Board Drill stop says "${stop.desc}" - the content manifest records ${CARDS} board cards`);

/* ---- 2. the Board entry in the main menu ---- */
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
const navTitle = await page.evaluate(() => { const a = document.querySelector('.nav a[href="#/board"]'); return a ? (a.getAttribute("title") || "") : null; });
(typeof navTitle === "string" && navTitle.startsWith(CARDS + " "))
  ? ok(`the menu's Board entry describes ${CARDS} cards - the whole bank, content packs included, not just the cards built into the page`)
  : bad(`the menu's Board entry says ${JSON.stringify(navTitle)} - the content manifest records ${CARDS} board cards`);

/* ---- 3. How current is this? ---- */
await page.evaluate(() => { location.hash = "#/currency"; });
// Wait for THIS page, not for "some hints": Home (where step 2 left us) already
// shows more than three, so a count-of-hints wait is satisfied before the route
// has changed and the cards below are then read off the wrong screen. Run
// against the pre-fix build, that race reported the untouched Terms card as ""
// - a failure for the wrong reason, and a flake waiting to happen on a loaded
// CI runner. The heading and the Terms card exist in every build, old or new.
const onCurrencyPage = await page.waitForFunction(() => /how current is this/i.test((document.querySelector("#route h1, #route h2") || {}).textContent || "")
  && Array.from(document.querySelectorAll("#route .hint")).some((h) => / terms\. The baseline is the oldest thing in the app/.test(h.textContent || "")), null, { timeout: 15000 }).then(() => true).catch(() => false);
onCurrencyPage ? ok("How current is this? has rendered its cards (the heading and the Terms card are on screen)") : bad("#/currency never rendered its cards within 15s - everything below would be read off the wrong screen");
const shown = await page.evaluate(() => Array.from(document.querySelectorAll("#route .hint")).map((h) => (h.textContent || "").trim()));
const doctrineLine = shown.find((t) => /entries and .* board cards\./.test(t)) || "";
doctrineLine === `${ENTRIES} entries and ${CARDS} board cards.`
  ? ok(`the Doctrine card shows "${doctrineLine}" - both figures are the manifest's (it said 336 entries)`)
  : bad(`the Doctrine card shows ${JSON.stringify(doctrineLine)} - expected "${ENTRIES} entries and ${CARDS} board cards."`);
const termsLine = shown.find((t) => / terms\. The baseline is the oldest thing in the app/.test(t)) || "";
termsLine.startsWith(TERMS + " terms.")
  ? ok(`the Terms card shows ${TERMS} terms, the manifest's figure`)
  : bad(`the Terms card shows ${JSON.stringify(termsLine)} - the content manifest records ${TERMS} terms`);

/* ---- 4. the sweep: no typed count anywhere in these descriptions disagrees with the bank ---- */
const copy = await page.evaluate(() => {
  const out = [];
  (G.tourHighlights || []).forEach((s) => out.push({ where: "Guided Tour stop: " + s.title, text: [s.desc, s.watch].filter(Boolean).join(" ") }));
  Object.keys(G.demoNotes || {}).forEach((hash) => { const n = G.demoNotes[hash] || {}; out.push({ where: "section description: " + hash, text: [n.d, n.w].filter(Boolean).join(" ") }); });
  ((G.currency && G.currency.DOMAINS) || []).forEach((d) => out.push({ where: "How current is this? card: " + d.area, text: [d.basis, d.implemented].filter(Boolean).join(" ") }));
  return out;
});
copy.length > 40 ? ok(`swept ${copy.length} on-screen descriptions (tour stops, section descriptions, currency cards)`) : bad("the sweep found only " + copy.length + " descriptions - G.tourHighlights / G.demoNotes / G.currency.DOMAINS moved?");
const wrong = [];
for (const c of copy) for (const d of docDisagreements(c.text, manifest)) wrong.push(`${c.where}: says ${say(d.quoted)} ${d.key}, the bank has ${say(d.live)}`);
wrong.length === 0
  ? ok("none of them quotes a card, term, doctrine-entry, scenario or MOS count that the content manifest disagrees with")
  : bad("typed counts that have gone stale - read them from the loaded content instead: " + wrong.join(" | "));
// The sweep has to be able to fail: the old Board Drill sentence must trip it.
const planted = docDisagreements("984 board cards, a real 3D flip, spaced repetition scheduling the next review.", manifest);
(planted.length === 1 && planted[0].quoted === 984 && planted[0].live === manifest.totals.board)
  ? ok("verifier check: the sentence this screen used to show (\"984 board cards ...\") is caught by the same sweep")
  : bad("verifier check: the old typed sentence was NOT caught: " + JSON.stringify(planted));

noise.length === 0 ? ok("no console errors/warnings or page errors") : bad("console noise: " + noise.join(" | "));
console.log(fails === 0 ? "\nLIVE CONTENT FIGURES: all passed" : `\nLIVE CONTENT FIGURES: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
