/**
 * PPW / Promotion Points calculator (#/board's "Points" tab, renderPoints):
 * the generic route sweep never switches rank after entering a value, so
 * the #120 regression - category caps differ by rank (SGT training max 280,
 * SSG max 230), and an already-entered value used to stay in place,
 * unclamped, after a rank switch changed the cap underneath it, so the
 * input box, its own "Max N" hint, and the calculated total could all
 * visibly disagree - had no interactive coverage. This drives a real rank
 * switch through the real UI and checks the input box itself, not just the
 * calculated total (which was already correctly clamped at calc time even
 * before this was fixed).
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

await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(500);
await page.locator("button", { hasText: /^Points$/ }).click();
await page.waitForTimeout(400);

const defaultRankActive = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.trim() === "SGT (E-5)");
  return b ? b.classList.contains("active") : null;
});
defaultRankActive === true ? ok("PPW defaults to SGT (E-5), Quick estimate mode") : bad("SGT button not active by default: " + defaultRankActive);

const trainingInput = page.locator('input[aria-label="Military training (weapons + AFT)"]');
await trainingInput.waitFor({ state: "visible", timeout: 5000 });
const hintBeforeSwitch = await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="Military training (weapons + AFT)"]');
  return inp?.closest(".card")?.querySelector(".hint")?.textContent || "";
});
/Max 280/.test(hintBeforeSwitch) ? ok("Training field's hint shows SGT's real cap (Max 280)") : bad("hint before switch: " + hintBeforeSwitch);

// Enter SGT's max (280) - valid at SGT, but exceeds SSG's 230 cap.
await trainingInput.fill("280");
await trainingInput.dispatchEvent("input");
await page.waitForTimeout(200);
const valueAtSgtMax = await trainingInput.inputValue();
valueAtSgtMax === "280" ? ok("Training input accepts 280 (valid at SGT's own cap, no reclamp needed yet)") : bad("value after entering 280: " + valueAtSgtMax);
const statAtSgtMax = await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="Military training (weapons + AFT)"]');
  return inp?.closest(".card")?.querySelector(".stat .v")?.textContent || "";
});
statAtSgtMax === "280" ? ok("The stat display next to the input also reads 280") : bad("stat display before switch: " + statAtSgtMax);

// Switch rank to SSG (cap drops to 230) - the actual #120 regression.
await page.locator("button", { hasText: /^SSG \(E-6\)$/ }).click();
await page.waitForTimeout(300);
const trainingInputAfterSwitch = page.locator('input[aria-label="Military training (weapons + AFT)"]');
const valueAfterSwitch = await trainingInputAfterSwitch.inputValue();
valueAfterSwitch === "230" ? ok("Switching to SSG reclamps the input box's own displayed value from 280 down to 230 (#120)") : bad("training input value after switching to SSG: " + valueAfterSwitch);

const statAfterSwitch = await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="Military training (weapons + AFT)"]');
  return inp?.closest(".card")?.querySelector(".stat .v")?.textContent || "";
});
statAfterSwitch === "230" ? ok("The stat display next to the input also updates to 230, agreeing with the input box") : bad("stat display after switch: " + statAfterSwitch);

const hintAfterSwitch = await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="Military training (weapons + AFT)"]');
  return inp?.closest(".card")?.querySelector(".hint")?.textContent || "";
});
/Max 230/.test(hintAfterSwitch) ? ok("The 'Max N' hint updates to SSG's real cap (Max 230), agreeing with the input and stat") : bad("hint after switch: " + hintAfterSwitch);

// Switch back to SGT: the reclamped value (230) is not restored to 280 -
// the app clamps in place, it doesn't remember the original entry.
await page.locator("button", { hasText: /^SGT \(E-5\)$/ }).click();
await page.waitForTimeout(300);
const valueBackAtSgt = await page.locator('input[aria-label="Military training (weapons + AFT)"]').inputValue();
valueBackAtSgt === "230" ? ok("Switching back to SGT leaves the value at 230 (clamped in place, not restored to the original 280)") : bad("value after switching back to SGT: " + valueBackAtSgt);

// ---- Full PPW mode: same reclamp applies to a different field with the
// opposite cap direction (SSG's awards cap 165 > SGT's 145) ----
await page.locator("button", { hasText: /^Full PPW$/ }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^SSG \(E-6\)$/ }).click();
await page.waitForTimeout(300);
const awardsInput = page.locator('input[aria-label="Points from permanent awards/decorations"]');
await awardsInput.waitFor({ state: "visible", timeout: 5000 });
await awardsInput.fill("165");
await awardsInput.dispatchEvent("input");
await page.waitForTimeout(200);
const awardsAtSsg = await awardsInput.inputValue();
awardsAtSsg === "165" ? ok("Full PPW's Awards field accepts 165 (valid at SSG's own cap)") : bad("awards value at SSG: " + awardsAtSsg);

await page.locator("button", { hasText: /^SGT \(E-5\)$/ }).click();
await page.waitForTimeout(300);
const awardsAfterSwitchToSgt = await page.locator('input[aria-label="Points from permanent awards/decorations"]').inputValue();
awardsAfterSwitchToSgt === "145" ? ok("Switching to SGT reclamps the Awards field from 165 down to SGT's 145 cap (#120, second field)") : bad("awards value after switching to SGT: " + awardsAfterSwitchToSgt);

// ---- Audit finding (new-features): Full PPW is the app's own stated
// "single source of truth" calculator but had zero persistence - every
// field reset on navigation. Enter a distinguishing value, wait for the
// debounced save, then leave the view entirely (destroying renderPoints()'s
// whole closure, including its in-memory `v` object) and come back - if the
// value is still there, it can only have come from a fresh IndexedDB read,
// not surviving JS memory.
const CZ_MONTHS = "7";
const czInput = page.locator('input[aria-label="Months of combat-zone service"]');
await czInput.waitFor({ state: "visible", timeout: 5000 });
await czInput.fill(CZ_MONTHS);
await czInput.dispatchEvent("input");
await page.waitForTimeout(500); // clears the 300ms debounce

await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /^Points$/ }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^Full PPW$/ }).click();
await page.waitForTimeout(300);
const czAfterRerender = await page.locator('input[aria-label="Months of combat-zone service"]').inputValue();
czAfterRerender === CZ_MONTHS
  ? ok("Full PPW worksheet field survives leaving and re-entering the view (persisted to IndexedDB, not just in-memory)")
  : bad("combat-zone months after re-render: expected " + CZ_MONTHS + ", got " + czAfterRerender);

// ---- Audit finding (rank/MOS scoping pass): the "MOS-enhancing
// credentials" field asked the Soldier to enter a count blind, with no
// visibility into which credentials for their own MOS would actually
// count - despite the Career Center's own civilianCertsByCMF list
// (11B -> CMF 11 -> 3 real illustrative credentials, verified against the
// seed directly) already existing two taps away. A guest session's
// profile lives only in an in-memory _cache and is never written to
// IndexedDB (G.profile.current() prefers that cache and never even reads
// storage while it's populated), so a raw db.put() to guidon:profile:v1
// is silently ignored for the rest of this run - a real personal profile
// + reload is required, matching the pattern test-career.mjs's own
// profile.mos prefill test and test-settings-toggles.mjs's Focus-tier
// confirm-gate test both already establish. ----
await page.evaluate(async () => {
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT", mos: "11B",
  } });
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1000);
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /^Points$/ }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^Full PPW$/ }).click();
await page.waitForTimeout(300);
const credHintText = await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="MOS-enhancing credentials (15 pts each)"]');
  const card = inp ? inp.closest(".card") : null;
  return card ? card.textContent : null;
});
(credHintText && /Illustrative candidates for 11B/.test(credHintText) && /OSHA 10\/30/.test(credHintText))
  ? ok("Full PPW: MOS-enhancing credentials field shows the real, MOS-specific candidate list for 11B (CMF 11)")
  : bad("MOS-enhancing credentials card text: " + credHintText);
const credOpenBtn = page.locator('input[aria-label="MOS-enhancing credentials (15 pts each)"]').locator("xpath=ancestor::div[contains(@class,'card')]//button", { hasText: /MOS Career Center/ });
if (await credOpenBtn.count()) {
  await credOpenBtn.click();
  await page.waitForTimeout(400);
  const hashAfterCredClick = await page.evaluate(() => location.hash);
  hashAfterCredClick === "#/career"
    ? ok("Full PPW: the credentials card's 'MOS Career Center' button actually navigates there")
    : bad("hash after clicking MOS Career Center button: " + hashAfterCredClick);
} else {
  bad("MOS Career Center button not found on the credentials card");
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPPW: all passed");
process.exit(fails ? 1 : 0);
