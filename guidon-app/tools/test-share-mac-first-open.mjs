/**
 * Share & Install, for someone on a Mac (audit U8).
 *
 * The Mac version GUIDON's release workflow posts is not registered with
 * Apple, so a downloaded copy is refused the first time it is opened - and the
 * refusal's only offer is "Move to Trash". Nothing in the app said that this
 * is expected or how to get past it safely. Worse, a Mac visitor to #/share
 * was told "You're on a computer" and handed the WINDOWS installer.
 *
 * Driven through the real page with real user agents:
 *   - a Mac is recognised and is never offered the Windows .exe
 *   - the Mac link goes to the releases LIST - there is no version-less Mac
 *     file for a /releases/latest/download/ permalink to point at, and not
 *     every release has a Mac version, so the copy must not promise one
 *   - the "Mac" steps are on the page, open by default on a computer, and are
 *     Apple's own route (Privacy & Security > Open Anyway) - never "turn off
 *     security" or a Terminal command
 *   - the copy is plain language (no signing / notarization vocabulary)
 *   - an iPad asking for the desktop site (it says "Macintosh") is still an
 *     iPad; Windows keeps its download; a phone gets the steps one tap away,
 *     keyboard-operable, with no sideways scrolling at 390 px
 *   - docs/mac-first-launch.md says the same thing as the app
 *
 * One browser.
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const MAC_CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const RELEASES = "https://github.com/CosmicGrub/The-Guidon/releases";
// Words a Soldier should never have to decode, and things we must never tell them to do.
const JARGON = /notari[sz]|gatekeeper|ad-?hoc|code ?sign|codesign|quarantine|unsigned|developer id|certificate/i;
const UNSAFE = /xattr|spctl|sudo |disable (gatekeeper|security)|--master-disable|allow apps from anywhere/i;

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];

async function sharePage(opts, init) {
  const ctx = await browser.newContext(opts);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "#/share"; });
  // No "Mac" panel at all is a finding, not a crash: let the checks below say so.
  await page.waitForFunction(() => [...document.querySelectorAll(".view .panel .eyebrow")].some((e) => e.textContent === "Mac"), null, { timeout: 15000 }).catch(() => {});
  return page;
}
const state = (page) => page.evaluate(() => {
  const panels = [...document.querySelectorAll(".view .panel")];
  const by = (t) => panels.find((p) => p.querySelector(".eyebrow")?.textContent === t);
  const rec = by("Get the app for this device"), mac = by("Mac");
  const toggle = mac?.querySelector("button.btn.sm.ghost");
  return {
    recText: rec?.textContent || "",
    recLinks: rec ? [...rec.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [],
    macText: mac?.textContent || "",
    macSteps: mac ? [...mac.querySelectorAll("ol > li")].map((li) => li.textContent) : [],
    macStepsVisible: mac ? [...mac.querySelectorAll("ol > li")].some((li) => li.offsetParent !== null) : false,
    macLinks: mac ? [...mac.querySelectorAll("a")].map((a) => ({ href: a.getAttribute("href"), rel: a.getAttribute("rel"), target: a.getAttribute("target") })) : [],
    macToggle: toggle ? { text: toggle.textContent, expanded: toggle.getAttribute("aria-expanded") } : null,
    allLinks: [...document.querySelectorAll(".view a")].map((a) => a.getAttribute("href") || ""),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});

/* 1 - Safari on a Mac */
{
  const page = await sharePage({ userAgent: MAC_UA, viewport: { width: 1280, height: 900 } });
  const s = await state(page);
  check(/You're on a Mac/.test(s.recText) && !/You're on a computer/.test(s.recText), "Mac: the page says so (it used to say “You're on a computer”)", "Mac: rec panel = " + s.recText);
  check(!s.recLinks.some((h) => /\.exe|\.msi|windows/i.test(h)), "Mac: is NOT offered the Windows installer (it used to be the one button on the panel)", "Mac: rec links = " + JSON.stringify(s.recLinks));
  check(s.recLinks.length === 1 && s.recLinks[0] === RELEASES, "Mac: the one link is the releases list", "Mac: rec links = " + JSON.stringify(s.recLinks));
  check(!s.allLinks.some((h) => /releases\/latest\/download\/[^/]*(mac|dmg)/i.test(h)), "Mac: no /latest/download/ permalink to a Mac file (none exists to point at)", "Mac: links = " + JSON.stringify(s.allLinks.filter((h) => /mac|dmg/i.test(h))));
  check(/nothing you have to download/i.test(s.recText) && /Some GUIDON releases include a Mac version.{0,40}and some don't/.test(s.recText), "Mac: says this page is already the full app, and that only SOME releases carry a Mac version", "Mac: rec panel = " + s.recText);
  check(/refuse to open it the first time/.test(s.recText) && /expected/.test(s.recText), "Mac: warns up front that the Mac will refuse the first open, and that this is expected", "Mac: rec panel = " + s.recText);

  check(s.macToggle === null && s.macStepsVisible, "Mac: the “Mac” steps are open by default", "Mac: toggle = " + JSON.stringify(s.macToggle) + " visible = " + s.macStepsVisible);
  check(s.macSteps.length >= 5, `Mac: the way through is a numbered list (${s.macSteps.length} steps)`, "Mac: steps = " + JSON.stringify(s.macSteps));
  const steps = s.macSteps.join(" | ");
  check(/System Settings/.test(steps) && /Privacy & Security/.test(steps) && /Open Anyway/.test(steps), "Mac: the steps are Apple's own route - System Settings, Privacy & Security, Open Anyway", steps);
  check(/about an hour/.test(steps), "Mac: says the Open Anyway button only stays for about an hour (or it looks like the steps are wrong)", steps);
  check(/macOS 12[^|]*Security & Privacy/.test(steps), "Mac: names the older System Preferences location too (the Mac version supports macOS 12)", steps);
  check(/do not choose “Move to Trash”/.test(steps), "Mac: tells them NOT to take the only button the warning offers", steps);
  check(/^Only do this with a copy you downloaded yourself from the GUIDON releases page/.test(s.macSteps[0] || ""), "Mac: step 1 is where the copy came from - the override is only safe for the official download", "step 1 = " + s.macSteps[0]);
  check(/That is expected/.test(s.macText) && /does not mean your download is bad/.test(s.macText), "Mac: explains the refusal is expected and not a sign of a bad download", s.macText);
  check(/Never turn off your Mac's security settings or paste commands into Terminal/.test(s.macText), "Mac: says never to switch off security or paste Terminal commands", s.macText);
  check(!UNSAFE.test(s.macText + s.recText), "Mac: and gives no such command or setting itself", (s.macText + s.recText).match(UNSAFE)?.[0]);
  check(!JARGON.test(s.macText + s.recText), "Mac: plain language - no signing or Apple-review vocabulary", "jargon: " + (s.macText + s.recText).match(JARGON)?.[0]);
  check(s.macLinks.length === 1 && s.macLinks[0].href === RELEASES && s.macLinks[0].target === "_blank" && /noopener/.test(s.macLinks[0].rel || ""), "Mac: the panel's link is the same releases list, opened safely in a new tab", JSON.stringify(s.macLinks));
  await page.context().close();
}

/* 2 - Chrome on a Mac is a Mac too */
{
  const page = await sharePage({ userAgent: MAC_CHROME_UA, viewport: { width: 1280, height: 900 } });
  const s = await state(page);
  check(/You're on a Mac/.test(s.recText) && !s.recLinks.some((h) => /\.exe/i.test(h)), "Mac (Chrome): recognised, no Windows installer", s.recText + JSON.stringify(s.recLinks));
  await page.context().close();
}

/* 3 - an iPad asking for the desktop site says "Macintosh". Still an iPad. */
{
  const page = await sharePage({ userAgent: MAC_UA, viewport: { width: 820, height: 1180 }, hasTouch: true }, () => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel", configurable: true });
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5, configurable: true });
  });
  const s = await state(page);
  check(/on an iPhone or iPad/.test(s.recText) && !/You're on a Mac/.test(s.recText), "iPad in desktop-site mode: still treated as an iPad, not sent to the Mac download", s.recText);
  check(s.macToggle && s.macToggle.expanded === "false", "iPad: the Mac steps are one tap away, not in the way", JSON.stringify(s.macToggle));
  await page.context().close();
}

/* 4 - Windows keeps its download, and can still read the Mac steps to pass on */
{
  const page = await sharePage({ userAgent: WIN_UA, viewport: { width: 1280, height: 900 } });
  const s = await state(page);
  check(/You're on a computer/.test(s.recText) && s.recLinks.some((h) => /GUIDON-windows-setup\.exe$/.test(h)), "Windows: unchanged - still gets the Windows installer", s.recText + JSON.stringify(s.recLinks));
  check(!/Mac and Linux don't have a native build/.test(s.recText) && /On a Mac, see the “Mac” steps below/.test(s.recText), "Windows: no longer says the Mac has no version of its own (one has been posted); points at the Mac steps instead", s.recText);
  check(s.macToggle === null && s.macStepsVisible, "Windows: Mac steps open by default, same “list them all” rule as the iPhone and Android panels", JSON.stringify(s.macToggle));
  await page.context().close();
}

/* 5 - a phone: collapsed, keyboard-operable, no sideways scroll at 390 px */
{
  const page = await sharePage({ userAgent: IOS_UA, viewport: { width: 390, height: 844 } });
  let s = await state(page);
  check(s.macToggle && s.macToggle.expanded === "false" && /Show Mac steps/.test(s.macToggle.text) && !s.macStepsVisible, "iPhone: Mac steps collapsed behind a “Show Mac steps” button", JSON.stringify(s.macToggle));
  await page.evaluate(() => {
    const mac = [...document.querySelectorAll(".view .panel")].find((p) => p.querySelector(".eyebrow")?.textContent === "Mac");
    mac?.querySelector("button.btn.sm.ghost")?.focus();
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  s = await state(page);
  check(s.macToggle?.expanded === "true" && /Hide Mac steps/.test(s.macToggle.text) && s.macStepsVisible, "iPhone: Enter on the button opens the steps and the button reports expanded", JSON.stringify(s.macToggle) + " visible=" + s.macStepsVisible);
  const focusKept = await page.evaluate(() => document.activeElement && /Hide Mac steps/.test(document.activeElement.textContent || ""));
  check(focusKept, "iPhone: keyboard focus stays on the button after it opens", "focus moved to " + (await page.evaluate(() => document.activeElement?.tagName)));
  check(s.overflow <= 1, "iPhone 390 px: the open Mac steps cause no sideways scrolling", "overflow " + s.overflow + "px");
  await page.context().close();
}

/* 6 - the written guidance says the same thing as the app */
{
  const doc = await readFile(path.join(HERE, "..", "docs", "mac-first-launch.md"), "utf8").catch(() => "");
  check(doc.length > 0, "docs/mac-first-launch.md exists", "docs/mac-first-launch.md is missing");
  check(/Privacy & Security/.test(doc) && /Open Anyway/.test(doc) && /about an hour/.test(doc) && /Move to Trash/.test(doc), "doc: same route as the app (Privacy & Security, Open Anyway, about an hour, not Move to Trash)", "doc lost a step the app gives");
  check(/Not every GUIDON release includes one/.test(doc) && !/releases\/latest\/download/.test(doc), "doc: does not promise a Mac download in every release, and links the releases list", "doc promises a download");
  check(/support\.apple\.com\/guide\/mac-help\/open-a-mac-app-from-an-unknown-developer/.test(doc), "doc: points at Apple's own page for the same steps", "doc has no Apple source");
  const userPart = doc.split(/\n---\n/)[0];
  check(!UNSAFE.test(userPart) && /\*\*never\*\* paste commands into Terminal/i.test(userPart.replace(/\s+/g, " ")), "doc: never tells the reader to run a command or switch security off - and says never to", "doc contains an unsafe instruction or lost the warning");
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
check(relevantNoise.length === 0, "no console errors or warnings in any of the 5 visits", "console noise: " + relevantNoise.slice(0, 8).join(" | "));

await browser.close();
await server.close();
console.log(fails ? `\n${fails} FAILURE(S)` : "\nSHARE MAC FIRST OPEN: all passed");
process.exit(fails ? 1 : 0);
