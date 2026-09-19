/**
 * Settings > Biometric lock: what the Soldier is told when it cannot be turned
 * on (audit C52).
 *
 * The iOS build offered this switch while its Info.plist had no Face ID
 * permission sentence, so iOS refused every attempt - and the app answered
 * EVERY refusal with one fixed line: "No fingerprint or face is set up on this
 * device - enroll one...". On an iPhone with Face ID already enrolled that is
 * untrue, and it sends the Soldier off to fix something that is not broken.
 * (The missing sentence itself is fixed in ios/App/App/Info.plist and held by
 * tools/lint-capacitor-config.mjs check (d) / tools/test-ios-config-lint.mjs.)
 *
 * Driven through the real Settings switch inside a mocked Capacitor shell -
 * the same technique as tools/test-biometric-lock.mjs - with the plugin's real
 * answer codes (identical on Android and iOS):
 *   - "not available" (what iOS says without the permission sentence, and what
 *     Android says with no sensor): stays off, never prompts, and does NOT
 *     claim nothing is enrolled
 *   - "not enrolled" / "no passcode" / "no screen lock": still gets the enroll
 *     sentence - that one is true there, and useful
 *   - the plugin's developer-worded reason is never shown
 *
 * One browser.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));

const { server, url } = await serve("web");
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const noise = [];
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });

// The answer checkBiometry() gives is read from localStorage on every call, so
// one page can walk through every code without a reload.
await context.addInitScript(() => {
  window.__bioAuthCalls = 0;
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      BiometricAuthNative: {
        checkBiometry: async () => JSON.parse(localStorage.getItem("__test_bioAnswer") || '{"isAvailable":true,"code":"","reason":""}'),
        internalAuthenticate: async () => { window.__bioAuthCalls++; },
      },
      App: { addListener: async () => ({ remove: () => {} }) },
    },
  };
});

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page, { mode: "guest" });
await page.evaluate(async () => {
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
    displayName: "SGT TESTFIRE", lastName: "TESTFIRE", anonymous: false,
    studyWeakPoints: [], readinessConcerns: [], actionPlan: [], promoPoints: {},
  } });
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => { location.hash = "#/settings"; });
const box = page.getByRole("checkbox", { name: "Biometric lock for Personal Account", exact: true });
await box.waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
check((await box.count()) === 1, "the Biometric lock switch is offered inside the app shell (as it is on iOS)", "Biometric lock switch not found on #/settings");

const statusText = () => page.evaluate(() => {
  const cb = document.querySelector('input[aria-label="Biometric lock for Personal Account"]');
  const panel = cb ? cb.closest(".panel") : null;
  return panel && panel.lastElementChild ? panel.lastElementChild.textContent : "";
});
async function tryTurnOn(answer) {
  await page.evaluate((a) => localStorage.setItem("__test_bioAnswer", JSON.stringify(a)), answer);
  await box.evaluate((e) => e.click());
  await page.waitForTimeout(300);
  return { checked: await box.isChecked(), text: await statusText(), calls: await page.evaluate(() => window.__bioAuthCalls) };
}

const IOS_REASON = "The device supports Face ID, but NSFaceIDUsageDescription is not in Info.plist.";

/* 1 - "not available": the iOS-without-the-sentence answer, word for word */
{
  const r = await tryTurnOn({ isAvailable: false, code: "biometryNotAvailable", reason: IOS_REASON });
  check(r.checked === false && r.calls === 0, "not available: the switch stays off and no fingerprint/face prompt is attempted", JSON.stringify(r));
  check(!/No fingerprint or face is set up|enroll one/i.test(r.text), "not available: does NOT tell the Soldier nothing is enrolled (it used to, for every refusal)", "status = " + JSON.stringify(r.text));
  check(/isn't available on this device right now/.test(r.text) && /left off/.test(r.text), "not available: says so plainly, and that the lock was left off", "status = " + JSON.stringify(r.text));
  check(!/NSFaceID|Info\.plist|biometryNotAvailable/.test(r.text), "not available: the plugin's developer wording is never shown", "status = " + JSON.stringify(r.text));
  const stored = await page.evaluate(async () => { const s = await window.G.db.get("kv", "settings"); return !!(s && s.v && s.v.biometricLock); });
  check(stored === false, "not available: nothing was saved as on", "biometricLock stored as " + stored);
}

/* 2 - an answer with no code at all (a bridge error) gets the same honest line */
{
  const r = await tryTurnOn({ isAvailable: false });
  check(r.checked === false && /isn't available on this device right now/.test(r.text), "no code at all: same plain line, never a guess about enrollment", JSON.stringify(r));
}

/* 3 - the codes where "set one up" IS the truth keep the enroll sentence */
for (const code of ["biometryNotEnrolled", "passcodeNotSet", "noDeviceCredential"]) {
  const r = await tryTurnOn({ isAvailable: false, code, reason: "x" });
  check(r.checked === false && r.calls === 0 && /No fingerprint or face is set up on this device/.test(r.text) && /enroll one in your device's system settings/.test(r.text),
    `${code}: still told to set one up in system settings (true there, and actionable)`, `${code}: ` + JSON.stringify(r));
}

/* 4 - and when it IS available the switch still turns on */
{
  const r = await tryTurnOn({ isAvailable: true, code: "", reason: "" });
  check(r.checked === true && r.calls === 1 && /^On /.test(r.text), "available: one prompt, the switch turns on", JSON.stringify(r));
}

check(noise.length === 0, "no console errors or warnings", "console noise: " + noise.slice(0, 6).join(" | "));

await browser.close();
await server.close();
console.log(fails ? `\n${fails} FAILURE(S)` : "\nBIOMETRIC UNAVAILABLE REASON: all passed");
process.exit(fails ? 1 : 0);
