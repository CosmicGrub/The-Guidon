/**
 * Doctrine confidence-field backfill (GUIDON files/ROADMAP.md, "doctrine
 * confidence-field backfill"): 32 doctrine.entries records shipped with NO
 * `confidence` field at all until a dedicated research pass tagged all of
 * them verified/in_transition/community (see tools/lint-doctrine-confidence.mjs
 * for the permanent completeness gate). That gap was not just cosmetic -
 * #/doctrine's own base-list filter (src/index.html ~8064-8072) reads
 * `d.confidence` to decide whether the "Show 'in transition' doctrine" /
 * "Show community / supplementary content" Settings toggles hide an entry;
 * an entry with no confidence field at all is neither "in_transition" nor
 * "community", so it always passed the filter regardless of toggle state -
 * a real (if minor) filter-correctness bug for any of those 32 entries that
 * SHOULD have been hideable.
 *
 * This test proves the toggles now do real, live work against real seed
 * content (not a mocked confidence value): pick one genuine "in_transition"
 * entry and one genuine "community" entry straight out of the shipped seed,
 * confirm both show by default, flip each Settings toggle off in turn via a
 * real UI click (same idiom tools/test-privacy.mjs uses for the Study
 * groups switch) and confirm ONLY the matching-confidence entry disappears
 * from #/doctrine's rendered card list, then flip back on and confirm both
 * reappear. Also confirms a "verified" entry is unaffected by either toggle
 * throughout, since verified entries must never be hideable.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

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
await dismissOnboarding(page);

// Make sure both toggles start from their true defaults, then pick one real
// in_transition entry, one real community entry and one real verified entry
// straight from the live seed - never hardcode a title/id, so this test
// keeps working no matter which specific entries carry which tag later.
await page.evaluate(async () => {
  await G.store.setSetting("showInTransition", true);
  await G.store.setSetting("showCommunity", true);
});
const picks = await page.evaluate(() => {
  const entries = G.store.doctrine();
  const pick = (conf) => { const e = entries.find((x) => x.confidence === conf); return e ? { id: e.id, title: e.title } : null; };
  return { inTransition: pick("in_transition"), community: pick("community"), verified: pick("verified"), total: entries.length };
});
picks.inTransition ? ok(`found a real in_transition entry to test with: "${picks.inTransition.title}"`) : bad("no in_transition entry found in the live seed - lint-doctrine-confidence.mjs should already have caught an empty distribution");
picks.community ? ok(`found a real community entry to test with: "${picks.community.title}"`) : bad("no community entry found in the live seed");
picks.verified ? ok(`found a real verified entry (control) to test with: "${picks.verified.title}"`) : bad("no verified entry found in the live seed");

async function gotoDoctrine() {
  // Force a real hashchange + re-render even when already on #/doctrine,
  // same technique test-doctrine-card-grid.mjs's cross-link case uses -
  // the base-list cache keys on showInTransition/showCommunity, but the
  // view itself only re-reads that cache on route entry, not on a bare
  // settings:change event.
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { location.hash = "#/doctrine"; });
  await page.waitForTimeout(500);
}
async function visibleTitles() {
  return page.evaluate(() => Array.from(document.querySelectorAll(".doc-title")).map((h) => h.textContent));
}
async function setToggleViaUI(label, checked) {
  const before = await page.evaluate((l) => {
    const sw = Array.from(document.querySelectorAll(".switch")).find((s) => (s.querySelector("span:not(.track)") || {}).textContent === l);
    return sw ? sw.querySelector("input[type=checkbox]").checked : null;
  }, label);
  if (before === checked) return true; // already in the desired state
  if (before === null) return false; // toggle not found
  await page.evaluate((l) => {
    const sw = Array.from(document.querySelectorAll(".switch")).find((s) => (s.querySelector("span:not(.track)") || {}).textContent === l);
    sw.querySelector("input[type=checkbox]").click();
  }, label);
  await page.waitForTimeout(150);
  return true;
}

if (picks.inTransition && picks.community && picks.verified) {
  await gotoDoctrine();
  const baseline = await visibleTitles();
  baseline.includes(picks.inTransition.title)
    ? ok("baseline (both toggles on): in_transition entry is shown")
    : bad("baseline: in_transition entry is NOT shown with both toggles on");
  baseline.includes(picks.community.title)
    ? ok("baseline (both toggles on): community entry is shown")
    : bad("baseline: community entry is NOT shown with both toggles on");
  baseline.includes(picks.verified.title)
    ? ok("baseline: verified control entry is shown")
    : bad("baseline: verified control entry is NOT shown");

  // ---- Settings: "Show 'in transition' doctrine" off -> only that entry hides ----
  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);
  const IT_LABEL = "Show 'in transition' doctrine";
  const foundIT = await setToggleViaUI(IT_LABEL, false);
  foundIT ? ok(`clicked the real "${IT_LABEL}" Settings toggle off`) : bad(`could not find the "${IT_LABEL}" Settings toggle`);
  const settingAfterOff = await page.evaluate(() => G.store.settings().showInTransition);
  settingAfterOff === false ? ok("showInTransition setting is now false") : bad("showInTransition setting did not flip to false: " + JSON.stringify(settingAfterOff));

  await gotoDoctrine();
  const withITOff = await visibleTitles();
  !withITOff.includes(picks.inTransition.title)
    ? ok(`in_transition entry "${picks.inTransition.title}" is HIDDEN with the toggle off - this is the real fix from the backfill`)
    : bad(`in_transition entry "${picks.inTransition.title}" is still shown with the toggle off`);
  withITOff.includes(picks.community.title)
    ? ok("community entry is unaffected (still shown) while only the in_transition toggle is off")
    : bad("community entry was incorrectly hidden by the in_transition toggle");
  withITOff.includes(picks.verified.title)
    ? ok("verified control entry is unaffected (still shown) while the in_transition toggle is off")
    : bad("verified control entry was incorrectly hidden by the in_transition toggle");

  // ---- restore, then repeat symmetrically for "Show community / supplementary content" ----
  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);
  await setToggleViaUI(IT_LABEL, true);
  const restored = await page.evaluate(() => G.store.settings().showInTransition);
  restored === true ? ok("showInTransition restored to true") : bad("showInTransition failed to restore to true: " + JSON.stringify(restored));

  const COMM_LABEL = "Show community / supplementary content";
  const foundComm = await setToggleViaUI(COMM_LABEL, false);
  foundComm ? ok(`clicked the real "${COMM_LABEL}" Settings toggle off`) : bad(`could not find the "${COMM_LABEL}" Settings toggle`);
  const commSettingOff = await page.evaluate(() => G.store.settings().showCommunity);
  commSettingOff === false ? ok("showCommunity setting is now false") : bad("showCommunity setting did not flip to false: " + JSON.stringify(commSettingOff));

  await gotoDoctrine();
  const withCommOff = await visibleTitles();
  !withCommOff.includes(picks.community.title)
    ? ok(`community entry "${picks.community.title}" is HIDDEN with the toggle off - the other half of the backfill's real fix`)
    : bad(`community entry "${picks.community.title}" is still shown with the toggle off`);
  withCommOff.includes(picks.inTransition.title)
    ? ok("in_transition entry is unaffected (shown again) while only the community toggle is off")
    : bad("in_transition entry was incorrectly hidden by the community toggle");
  withCommOff.includes(picks.verified.title)
    ? ok("verified control entry is unaffected (still shown) while the community toggle is off")
    : bad("verified control entry was incorrectly hidden by the community toggle");

  // ---- restore both, confirm everything is back ----
  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);
  await setToggleViaUI(COMM_LABEL, true);
  const commRestored = await page.evaluate(() => G.store.settings().showCommunity);
  commRestored === true ? ok("showCommunity restored to true") : bad("showCommunity failed to restore to true: " + JSON.stringify(commRestored));

  await gotoDoctrine();
  const final = await visibleTitles();
  (final.includes(picks.inTransition.title) && final.includes(picks.community.title) && final.includes(picks.verified.title))
    ? ok("both toggles back on: all three entries (in_transition, community, verified) are shown again")
    : bad("both toggles back on: not all three entries reappeared - " + JSON.stringify({ has: final.filter((t) => [picks.inTransition.title, picks.community.title, picks.verified.title].includes(t)) }));
} else {
  bad("skipped the toggle-behavior assertions because one or more real confidence picks were missing (see above)");
}

noise.length === 0 ? ok("no console errors/warnings across the whole run") : bad("console noise: " + noise.join(" | "));

console.log(fails === 0 ? "\nDOCTRINE CONFIDENCE FILTERS: all passed" : `\nDOCTRINE CONFIDENCE FILTERS: ${fails} failed`);
await page.close();
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
