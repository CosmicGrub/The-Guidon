/**
 * Roadmap Tier 3 "self-heal jump-links": Diagnostics' own "Self-healing" log
 * (js/selfheal.js's G.selfheal, rendered by js/selftest.js's render()) used
 * to show every entry as flat, unlinked text - kind + key + timestamp +
 * detail, no way to act on it. Every G.selfheal.log(kind, key, detail) call
 * site already names a real owning route through its kind (a "srs-write-
 * fail" entry's key is a real Board Drill question id; "profile-write-fail"
 * belongs to the Profile view), so selftest.js's new SELFHEAL_ROUTES map
 * (see that module's own header comment) turns each entry with a sensible
 * target into a real "Go to <Section> →" button. Clicking it hands the
 * entry's key off through the SAME shared G.nav.seed(target, value)/
 * consume(target) registry Global Search's own result-click handlers use
 * (test-nav-seed.mjs covers that registry directly) and changes
 * location.hash to the owning route.
 *
 * Exercises:
 *   1. a seeded "srs-write-fail" entry (Board Drill's own kind, key = a
 *      real board question id) renders a "Go to Board Drill →" button that
 *      lands on #/board and has seeded G.nav's "board" slot with that id.
 *   2. a seeded "profile-write-fail" entry (key: null, same as the real
 *      saveProfile() catch logs it - see test-selfheal-audit.mjs) renders a
 *      "Go to Profile →" button that lands on #/profile.
 *   3. a seeded "settings-backfill" entry renders a "Go to Settings →"
 *      button that lands on #/settings and seeds G.nav's "settings" slot
 *      with the real backfilled-field list as its key.
 *   4. a seeded "repair" entry (selftest.js's own kind - service-worker/
 *      storage/statusbar repairs that already happen ON this page) renders
 *      with NO jump-link at all - a link back to the page already open
 *      would be dead weight, not a shortcut.
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

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

// A real board question id, pulled straight from the store the same way
// test-nav-seed.mjs pulls a real scenario title - not a guessed literal
// that could silently stop matching if the seed content ever changes.
const realQuestionId = await page.evaluate(() => {
  const qs = (window.G.store && window.G.store.boardQuestions) ? window.G.store.boardQuestions() : [];
  return qs.length ? qs[0].id : null;
});
realQuestionId ? ok("fetched a real board question id from the store: " + realQuestionId) : bad("could not fetch a real board question id from the store");

// Seed four self-heal entries directly through the real G.selfheal.log() -
// same call every actual catch site in the app uses (see js/selfheal.js) -
// rather than hand-writing IndexedDB rows, so this test exercises the exact
// path a genuine failure would take up to the point selftest.js renders it.
await page.evaluate(async (qid) => {
  await window.G.selfheal.log("srs-write-fail", qid, "grade(gradeLevel=1) failed: simulated QA write failure");
  await window.G.selfheal.log("profile-write-fail", null, "saveProfile() failed: simulated QA write failure");
  await window.G.selfheal.log("settings-backfill", "theme,textSize", "2 field(s) backfilled from defaults: theme, textSize");
  await window.G.selfheal.log("repair", "storage-persist", "persistent storage granted on re-ask");
}, realQuestionId);

await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(500);

// Several ".stat .k" nodes exist on this page (the automated-check summary
// renders its own "Not yet run"/"N passing..." stat above this one) - find
// the Self-healing panel specifically by its own eyebrow text, the same way
// entryCardFor() below locates entry cards by their own text rather than
// position.
const healCountText = await page.evaluate(() => {
  const eyebrows = Array.from(document.querySelectorAll(".eyebrow"));
  const heal = eyebrows.find((e) => e.textContent === "Self-healing");
  const stat = heal && heal.parentElement ? heal.parentElement.querySelector(".stat .k") : null;
  return stat ? stat.textContent : "";
});
/repair\(s\) since install/.test(healCountText || "")
  ? ok("Self-healing panel shows a nonzero repair count after seeding (\"" + healCountText + "\")")
  : bad("Self-healing panel did not pick up the seeded entries: " + JSON.stringify(healCountText));

await page.locator("button", { hasText: /Show recent entries/ }).click();
await page.waitForTimeout(300);

// Scoped to the Self-healing panel's own entry list specifically - "div.card"
// also appears elsewhere on this same page (the automated-check results, the
// kv "Review & repair" panel), so an unscoped query would silently pass by
// counting unrelated cards instead of the seeded self-heal entries.
async function healListCards() {
  return page.evaluate(() => {
    const eyebrows = Array.from(document.querySelectorAll(".eyebrow"));
    const heal = eyebrows.find((e) => e.textContent === "Self-healing");
    const panel = heal ? heal.parentElement : null;
    return panel ? Array.from(panel.querySelectorAll("div.card")) : [];
  });
}

const cardCount = (await healListCards()).length;
cardCount >= 4 ? ok("Self-healing entry list renders a card per seeded entry (" + cardCount + " card(s))") : bad("expected >=4 entry cards, found " + cardCount);

// ---- helper: find the entry card for a given kind, read its jump-link (if any) ----
async function entryCardFor(kindSubstr) {
  return page.evaluate((needle) => {
    const eyebrows = Array.from(document.querySelectorAll(".eyebrow"));
    const heal = eyebrows.find((e) => e.textContent === "Self-healing");
    const panel = heal ? heal.parentElement : null;
    const cards = panel ? Array.from(panel.querySelectorAll("div.card")) : [];
    const card = cards.find((c) => {
      const cat = c.querySelector(".ob-plan-cat");
      return cat && cat.textContent.indexOf(needle) === 0;
    });
    if (!card) return null;
    const btn = Array.from(card.querySelectorAll("button")).find((b) => /^Go to /.test(b.textContent || ""));
    return { catText: card.querySelector(".ob-plan-cat").textContent, hasBtn: !!btn, btnText: btn ? btn.textContent : null };
  }, kindSubstr);
}

// ---- helper: click a given entry's own jump-link button, scoped to the
// Self-healing panel the same way entryCardFor() reads it above ----
async function clickJumpLinkFor(kindSubstr) {
  await page.evaluate((needle) => {
    const eyebrows = Array.from(document.querySelectorAll(".eyebrow"));
    const heal = eyebrows.find((e) => e.textContent === "Self-healing");
    const panel = heal ? heal.parentElement : null;
    const cards = panel ? Array.from(panel.querySelectorAll("div.card")) : [];
    const card = cards.find((c) => {
      const cat = c.querySelector(".ob-plan-cat");
      return cat && cat.textContent.indexOf(needle) === 0;
    });
    const btn = card ? Array.from(card.querySelectorAll("button")).find((b) => /^Go to /.test(b.textContent || "")) : null;
    if (btn) btn.click();
  }, kindSubstr);
}

// ---- 1. srs-write-fail -> Board Drill, seeds G.nav's "board" slot with the real question id ----
const srsCard = await entryCardFor("srs-write-fail");
(srsCard && srsCard.hasBtn && srsCard.btnText === "Go to Board Drill →")
  ? ok('srs-write-fail entry ("' + (srsCard && srsCard.catText) + '") renders a "Go to Board Drill →" jump-link')
  : bad("srs-write-fail entry jump-link: " + JSON.stringify(srsCard));

if (srsCard && srsCard.hasBtn) {
  await clickJumpLinkFor("srs-write-fail");
  await page.waitForTimeout(400);
  const afterSrs = await page.evaluate((qid) => ({
    hash: location.hash,
    h2: (document.querySelector(".section-title h2") || {}).textContent || "",
    seeded: window.G.nav.consume("board"),
  }), realQuestionId);
  afterSrs.hash === "#/board" && afterSrs.h2 === "Board Drill"
    ? ok("clicking the srs-write-fail jump-link lands on #/board (Board Drill)")
    : bad("state after clicking srs-write-fail jump-link: " + JSON.stringify(afterSrs));
  afterSrs.seeded === realQuestionId
    ? ok('the jump-link seeded G.nav\'s "board" slot with the real question id before navigating')
    : bad('G.nav.consume("board") after the jump: ' + JSON.stringify(afterSrs.seeded) + " (expected " + JSON.stringify(realQuestionId) + ")");
}

// ---- 2. profile-write-fail -> Profile ----
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /Show recent entries/ }).click();
await page.waitForTimeout(300);

const profileCard = await entryCardFor("profile-write-fail");
(profileCard && profileCard.hasBtn && profileCard.btnText === "Go to Profile →")
  ? ok('profile-write-fail entry renders a "Go to Profile →" jump-link')
  : bad("profile-write-fail entry jump-link: " + JSON.stringify(profileCard));

if (profileCard && profileCard.hasBtn) {
  await clickJumpLinkFor("profile-write-fail");
  await page.waitForTimeout(400);
  const afterProfile = await page.evaluate(() => ({ hash: location.hash }));
  afterProfile.hash === "#/profile"
    ? ok("clicking the profile-write-fail jump-link lands on #/profile")
    : bad("state after clicking profile-write-fail jump-link: " + JSON.stringify(afterProfile));
}

// ---- 3. settings-backfill -> Settings, seeds G.nav's "settings" slot with the real field list ----
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /Show recent entries/ }).click();
await page.waitForTimeout(300);

const settingsCard = await entryCardFor("settings-backfill");
(settingsCard && settingsCard.hasBtn && settingsCard.btnText === "Go to Settings →")
  ? ok('settings-backfill entry renders a "Go to Settings →" jump-link')
  : bad("settings-backfill entry jump-link: " + JSON.stringify(settingsCard));

if (settingsCard && settingsCard.hasBtn) {
  await clickJumpLinkFor("settings-backfill");
  await page.waitForTimeout(400);
  const afterSettings = await page.evaluate(() => ({ hash: location.hash, seeded: window.G.nav.consume("settings") }));
  afterSettings.hash === "#/settings"
    ? ok("clicking the settings-backfill jump-link lands on #/settings")
    : bad("state after clicking settings-backfill jump-link: " + JSON.stringify(afterSettings));
  afterSettings.seeded === "theme,textSize"
    ? ok('the jump-link seeded G.nav\'s "settings" slot with the real backfilled-field key')
    : bad('G.nav.consume("settings") after the jump: ' + JSON.stringify(afterSettings.seeded));
}

// ---- 4. "repair" kind entries get NO jump-link (self-referential to this same page) ----
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /Show recent entries/ }).click();
await page.waitForTimeout(300);

const repairCard = await entryCardFor("repair");
(repairCard && !repairCard.hasBtn)
  ? ok('a "repair" kind entry (already-on-this-page self-test repairs) renders with no jump-link')
  : bad("repair entry unexpectedly has a jump-link, or was not found: " + JSON.stringify(repairCard));

noise.length === 0 ? ok("no console errors") : bad("console noise: " + noise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSELFHEAL JUMPLINKS: all passed");
process.exit(fails ? 1 : 0);
