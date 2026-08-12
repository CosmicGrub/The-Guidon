/**
 * MOS Career Center (#/career, G.career): a direct (non-tab-gated) route, so
 * the generic route sweep reaches it structurally - but never types into the
 * MOS lookup, so findMos()'s case-insensitive matching, the unknown-code
 * empty state, the civilian-certs/WO-feeder cross-reference panels, and the
 * profile.mos auto-prefill had no coverage of any kind before this.
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

await page.evaluate(() => { location.hash = "#/career"; });
await page.waitForTimeout(500);

const mosInput = page.locator('input[aria-label="MOS code"]');
async function search(code) {
  await mosInput.fill(code);
  await page.waitForTimeout(350); // debounce is 150ms
}

// --- known code, "BALANCED" fallback status ---
await search("11B");
let text = await page.evaluate(() => document.body.textContent || "");
/11B — Infantryman/.test(text) ? ok("searching '11B' shows the matching MOS title") : bad("11B title not shown");
/BALANCED/.test(text) ? ok("11B's 'normal' status falls back to the BALANCED badge") : bad("BALANCED badge not shown for 11B");
/OSHA 10\/30/.test(text) ? ok("CMF 11 civilian-certifications panel renders for 11B") : bad("civilian certs panel missing for 11B");

// --- case-insensitive match + a 'shortage' status code ---
await search("13f");
text = await page.evaluate(() => document.body.textContent || "");
/13F — Joint Fire Support Specialist/.test(text) ? ok("lowercase '13f' still matches (case-insensitive lookup)") : bad("lowercase search didn't match 13F");
/FY26 SHORTAGE \/ GROWTH/.test(text) ? ok("13F's 'shortage' status shows the shortage/growth badge") : bad("shortage badge not shown for 13F");

// --- warrant officer feeder cross-reference (92-series feeder match) ---
await search("92A");
text = await page.evaluate(() => document.body.textContent || "");
(/Warrant Officer Feeder Pathway/.test(text) && /920A/.test(text))
  ? ok("92A shows the Warrant Officer Feeder Pathway panel (92-series match)")
  : bad("WO feeder pathway panel missing/incomplete for 92A");

// --- unknown code ---
await search("99Z");
text = await page.evaluate(() => document.body.textContent || "");
/No MOS match for.*99Z/.test(text) ? ok("an unknown code shows a specific 'no match' message naming the code") : bad("no-match message missing/generic for '99Z'");

// --- empty input ---
await mosInput.fill("");
await page.waitForTimeout(350);
text = await page.evaluate(() => document.body.textContent || "");
/Enter your MOS above/.test(text) ? ok("clearing the input shows the initial prompt") : bad("initial prompt not shown after clearing");

// --- profile.mos auto-prefill (needs a fresh page load so profile.js's module cache reloads) ---
await page.evaluate(async () => {
  const cur = await window.G.db.get("kv", "guidon:profile:v1");
  const p = (cur && cur.v) || {};
  p.mos = "19D";
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: p });
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => { location.hash = "#/career"; });
await page.waitForTimeout(600);
const prefillVal = await mosInput.inputValue();
text = await page.evaluate(() => document.body.textContent || "");
prefillVal === "19D" ? ok("profile.mos ('19D') auto-prefills the search input") : bad("input value after reload: " + JSON.stringify(prefillVal));
(/19D — Cavalry Scout/.test(text) && /OVERSTRENGTH \/ RESTRICTED/.test(text))
  ? ok("the prefilled MOS renders its result card without any typing")
  : bad("prefilled result card missing/incorrect for 19D");

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `CAREER: ${fails} FAILURE(S)` : "CAREER: all passed"));
process.exit(fails ? 1 : 0);
